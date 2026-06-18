// LangGraph StateGraph for the receipts agent.
//
// Workers note: Cloudflare Workers are stateless and can't open raw Postgres
// sockets, so we don't use a LangGraph checkpointer. Instead we persist
// per-run state to our own `agent_runs.state` JSONB column and the
// `approvals` table. Approval nodes consult an in-state `decisions` map:
// - decision present  -> use it, proceed
// - decision absent   -> write an `approvals` row, set `pendingApproval`,
//                        and the graph routes to END for this invocation
// On resumeRun the server fn writes the decision and re-invokes the graph
// with the full prior state; nodes already completed are short-circuited
// because their outputs are already in state.

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assignTo,
  calendarCreateEvent,
  saveItem,
  ToolError,
  visionExtract,
} from "./tools.server";
import type {
  ApprovalProposal,
  AssignmentProposal,
  Assignee,
  ExtractedItem,
} from "./types";

export interface AgentDeps {
  supabase: SupabaseClient;
  userId: string;
  runId: string;
  recordEvent: (
    node: string,
    kind: "start" | "end" | "tool" | "error" | "interrupt" | "retry",
    payload: Record<string, unknown>
  ) => Promise<void>;
  writeApproval: (key: string, node: string, actionKind: string, proposal: ApprovalProposal) => Promise<void>;
}

export interface InitialInput {
  source: "photo" | "gmail";
  imageUrl?: string | null;
  text?: string | null;
  sourceRef: Record<string, unknown>;
}

export type EditPatchSave = Partial<ExtractedItem> & { assignee?: Assignee };
export type EditPatchCal = { summary?: string; description?: string; startISO?: string; endISO?: string };
export type DecisionSave = { action: "approve" | "edit" | "reject"; patch?: EditPatchSave };
export type DecisionCal = { action: "approve" | "edit" | "reject"; patch?: EditPatchCal };
export type DecisionLog = { approveSave?: DecisionSave; approveCalendar?: DecisionCal };

export interface AgentState {
  input: InitialInput;
  extracted: ExtractedItem | null;
  assignment: AssignmentProposal | null;
  itemId: string | null;
  calendarEventId: string | null;
  decisions: DecisionLog;
  pendingApproval: string | null;
  errors: { node: string; message: string }[];
}

const State = Annotation.Root({
  input: Annotation<InitialInput>({ reducer: (_, b) => b }),
  extracted: Annotation<ExtractedItem | null>({ reducer: (_, b) => b, default: () => null }),
  assignment: Annotation<AssignmentProposal | null>({ reducer: (_, b) => b, default: () => null }),
  itemId: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  calendarEventId: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  decisions: Annotation<DecisionLog>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  pendingApproval: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  errors: Annotation<{ node: string; message: string }[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
});

type S = typeof State.State;

async function withRetry<T>(
  deps: AgentDeps,
  node: string,
  fn: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const retriable = e instanceof ToolError ? e.retriable : true;
      await deps.recordEvent(node, "retry", {
        attempt: i,
        max: maxAttempts,
        error: (e as Error).message,
      });
      if (!retriable || i === maxAttempts) break;
      await new Promise((r) => setTimeout(r, 250 * i));
    }
  }
  throw lastErr;
}

export function buildGraph(
  deps: AgentDeps,
  assignmentRules: { owner: Assignee; keywords: string[] }[]
) {
  const g = new StateGraph(State);

  g.addNode("ingest", async (s: S) => {
    if (s.extracted) return {}; // resumed; already past ingest
    await deps.recordEvent("ingest", "start", { source: s.input.source });
    return {};
  });

  g.addNode("extract", async (s: S) => {
    if (s.extracted) return {};
    await deps.recordEvent("extract", "start", {
      model: "google/gemini-2.5-flash",
      hasImage: !!s.input.imageUrl,
    });
    const storagePath = (s.input.sourceRef as { storagePath?: string } | undefined)?.storagePath;
    const purgeImage = async () => {
      if (!storagePath) return;
      try {
        await deps.supabase.storage.from("receipts").remove([storagePath]);
        await deps.recordEvent("extract", "tool", { deletedImage: storagePath });
      } catch (err) {
        await deps.recordEvent("extract", "error", { deleteImage: (err as Error).message });
      }
    };
    try {
      // Fetch up to 2 most recent golden examples to few-shot the extractor
      const { data: goldens } = await deps.supabase
        .from("golden_examples")
        .select("title, notes, expected_items")
        .eq("user_id", deps.userId)
        .order("created_at", { ascending: false })
        .limit(2);
      const examples = (goldens ?? []).map((g) => ({
        title: g.title as string,
        notes: (g.notes as string | null) ?? null,
        expected_items: Array.isArray(g.expected_items) ? (g.expected_items as unknown[]) : [],
      }));
      const extracted = await withRetry(deps, "extract", () =>
        visionExtract(
          { imageUrl: s.input.imageUrl ?? undefined, text: s.input.text ?? undefined },
          examples,
        ),
      );
      await deps.recordEvent("extract", "end", { extracted, fewShotCount: examples.length });
      await purgeImage();
      return { extracted };
    } catch (e) {
      await deps.recordEvent("extract", "error", { error: (e as Error).message });
      await purgeImage();
      return { errors: [{ node: "extract", message: (e as Error).message }] };
    }
  });

  g.addNode("assign", async (s: S) => {
    if (s.assignment || !s.extracted) return {};
    await deps.recordEvent("assign", "start", {});
    const assignment = await assignTo(s.extracted, assignmentRules);
    await deps.recordEvent("assign", "end", { assignment });
    return { assignment };
  });

  g.addNode("approveSave", async (s: S) => {
    if (s.itemId) return {}; // already saved
    if (!s.extracted || !s.assignment) return {};
    const decision = s.decisions.approveSave;
    const AUTO_APPROVE_THRESHOLD = 0.85;
    const highConfidence =
      (s.extracted.category_confidence ?? 0) >= AUTO_APPROVE_THRESHOLD &&
      (s.assignment.confidence ?? 0) >= AUTO_APPROVE_THRESHOLD;
    if (!decision && !highConfidence) {
      const proposal: ApprovalProposal = {
        kind: "save_item",
        item: s.extracted,
        assignment: s.assignment,
      };
      await deps.writeApproval("approveSave", "approveSave", "save_item", proposal);
      await deps.recordEvent("approveSave", "interrupt", { proposal });
      return { pendingApproval: "approveSave" };
    }
    if (decision?.action === "reject") {
      await deps.recordEvent("approveSave", "end", { decision, status: "rejected" });
      return {};
    }
    const item = { ...s.extracted, ...(decision?.patch ?? {}) } as ExtractedItem;
    const assignment: AssignmentProposal =
      decision?.patch?.assignee != null
        ? { ...s.assignment, assignee: decision.patch.assignee }
        : s.assignment;
    const itemId = await saveItem(
      deps.supabase,
      deps.userId,
      deps.runId,
      item,
      assignment,
      s.input.source,
      null, // image is purged after extract — never store URL
      s.input.sourceRef
    );
    await deps.recordEvent("approveSave", "end", {
      decision: decision ?? { action: "auto-approve", reason: "high confidence" },
      itemId,
      auto: !decision,
    });
    return { extracted: item, assignment, itemId };
  });

  g.addNode("approveCalendar", async (s: S) => {
    if (s.calendarEventId) return {};
    if (!s.extracted) return {};
    const dueLike = s.extracted.due_at ?? s.extracted.expires_at ?? s.extracted.rsvp_by;
    if (!dueLike) return {};
    const decision = s.decisions.approveCalendar;
    const startISO = dueLike;
    const endISO = new Date(new Date(dueLike).getTime() + 30 * 60_000).toISOString();
    const summary = `${s.extracted.title}${s.extracted.due_at ? " — due" : s.extracted.expires_at ? " — expires" : " — RSVP"}`;
    const description = [
      s.extracted.merchant ? `Merchant: ${s.extracted.merchant}` : "",
      s.extracted.amount != null ? `Amount: ${s.extracted.amount} ${s.extracted.currency ?? ""}` : "",
      s.extracted.description ?? "",
      `Assigned to: ${s.assignment?.assignee ?? "either"}`,
    ]
      .filter(Boolean)
      .join("\n");
    const proposal: ApprovalProposal = { kind: "create_calendar_event", summary, description, startISO, endISO };
    // Auto-create: the user already approved saving the item, so don't gate
    // the calendar event behind a second approval. Honor an explicit reject
    // if one was provided programmatically.
    if (decision?.action === "reject") {
      await deps.recordEvent("approveCalendar", "end", { decision, status: "rejected" });
      return {};
    }
    try {
      const merged = { ...proposal, ...(decision.patch ?? {}) };
      const ev = await withRetry(deps, "approveCalendar", () =>
        calendarCreateEvent({
          summary: merged.summary,
          description: merged.description,
          startISO: merged.startISO,
          endISO: merged.endISO,
        })
      );
      await deps.recordEvent("approveCalendar", "tool", { eventId: ev.id, link: ev.htmlLink });
      if (s.itemId) {
        await deps.supabase.from("items").update({ calendar_event_id: ev.id }).eq("id", s.itemId);
      }
      return { calendarEventId: ev.id };
    } catch (e) {
      await deps.recordEvent("approveCalendar", "error", { error: (e as Error).message });
      return { errors: [{ node: "approveCalendar", message: (e as Error).message }] };
    }
  });

  g.addNode("scheduleFollowup", async (s: S) => {
    if (!s.itemId) return {};
    const dueLike = s.extracted?.due_at ?? s.extracted?.expires_at ?? s.extracted?.rsvp_by;
    if (!dueLike) return {};
    const dueMs = new Date(dueLike).getTime();
    if (Number.isNaN(dueMs)) return {};
    const nudgeAt = new Date(Math.max(Date.now() + 60_000, dueMs - 24 * 3600_000));
    // Avoid duplicates on resume
    const { data: existing } = await deps.supabase
      .from("followups")
      .select("id")
      .eq("item_id", s.itemId)
      .maybeSingle();
    if (existing) return {};
    const { error } = await deps.supabase.from("followups").insert({
      user_id: deps.userId,
      item_id: s.itemId,
      next_nudge_at: nudgeAt.toISOString(),
      channel: "in_app",
      state: "scheduled",
    });
    if (error) await deps.recordEvent("scheduleFollowup", "error", { error: error.message });
    else await deps.recordEvent("scheduleFollowup", "end", { nudgeAt: nudgeAt.toISOString() });
    return {};
  });

  const ifPending = (s: S, next: string) => (s.pendingApproval ? END : next);

  g.addEdge(START, "ingest" as never);
  g.addEdge("ingest" as never, "extract" as never);
  g.addConditionalEdges(
    "extract" as never,
    (s: S) => (s.extracted ? "assign" : END),
    { assign: "assign" as never, [END]: END }
  );
  g.addEdge("assign" as never, "approveSave" as never);
  g.addConditionalEdges(
    "approveSave" as never,
    (s: S) => ifPending(s, s.itemId ? "approveCalendar" : END),
    { approveCalendar: "approveCalendar" as never, [END]: END }
  );
  g.addConditionalEdges(
    "approveCalendar" as never,
    (s: S) => ifPending(s, "scheduleFollowup"),
    { scheduleFollowup: "scheduleFollowup" as never, [END]: END }
  );
  g.addEdge("scheduleFollowup" as never, END);

  return g.compile();
}

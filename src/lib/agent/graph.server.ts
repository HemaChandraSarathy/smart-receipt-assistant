// LangGraph StateGraph for the receipts agent.
//
// Workers note: Cloudflare Workers are stateless. We DON'T use a Postgres
// checkpointer (no pg sockets). Instead we persist agent state in our own
// `agent_runs.input_ref` / decisions, then rebuild and re-invoke the graph
// on resume — playing back saved decisions through interrupt boundaries.
//
// Each invocation: build graph -> .invoke({...state, decisions}) -> graph
// runs forward until it either ends or hits an interrupt() it has no
// recorded decision for. The server fn writes the new pending approval and
// returns; the next resumeRun call adds the decision and re-invokes.

import { StateGraph, START, END, Annotation, interrupt } from "@langchain/langgraph";
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
}

export interface InitialInput {
  source: "photo" | "gmail";
  imageUrl?: string | null;
  text?: string | null;
  sourceRef: Record<string, unknown>;
}

// Recorded HITL decisions; key is the interrupt id (= node name + step)
export type DecisionLog = Record<string, unknown>;

const State = Annotation.Root({
  input: Annotation<InitialInput>({ reducer: (_, b) => b }),
  extracted: Annotation<ExtractedItem | null>({ reducer: (_, b) => b, default: () => null }),
  assignment: Annotation<AssignmentProposal | null>({ reducer: (_, b) => b, default: () => null }),
  itemId: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  calendarEventId: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  errors: Annotation<{ node: string; message: string }[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
  decisions: Annotation<DecisionLog>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
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

export function buildGraph(deps: AgentDeps, assignmentRules: { owner: "mom" | "dad" | "either"; keywords: string[] }[]) {
  const g = new StateGraph(State);

  g.addNode("ingest", async (s: S) => {
    await deps.recordEvent("ingest", "start", { source: s.input.source });
    return {};
  });

  g.addNode("extract", async (s: S) => {
    await deps.recordEvent("extract", "start", {});
    try {
      const extracted = await withRetry(deps, "extract", () =>
        visionExtract({ imageUrl: s.input.imageUrl ?? undefined, text: s.input.text ?? undefined })
      );
      await deps.recordEvent("extract", "end", { extracted });
      return { extracted };
    } catch (e) {
      await deps.recordEvent("extract", "error", { error: (e as Error).message });
      return { errors: [{ node: "extract", message: (e as Error).message }] };
    }
  });

  g.addNode("assign", async (s: S) => {
    if (!s.extracted) return {};
    await deps.recordEvent("assign", "start", {});
    const assignment = await assignTo(s.extracted, assignmentRules);
    await deps.recordEvent("assign", "end", { assignment });
    return { assignment };
  });

  g.addNode("approveSave", async (s: S) => {
    if (!s.extracted || !s.assignment) return {};
    const key = "approveSave";
    const proposal: ApprovalProposal = {
      kind: "save_item",
      item: s.extracted,
      assignment: s.assignment,
    };
    await deps.recordEvent("approveSave", "interrupt", { proposal });
    // interrupt() returns the resumed value when re-invoked with that decision.
    const decision = interrupt({ key, proposal }) as
      | { action: "approve" | "edit" | "reject"; patch?: Partial<ExtractedItem & { assignee: "mom" | "dad" | "either" }> }
      | undefined;
    if (!decision || decision.action === "reject") {
      await deps.recordEvent("approveSave", "end", { decision: decision ?? null, status: "rejected" });
      return {};
    }
    const item = { ...s.extracted, ...(decision.patch ?? {}) } as ExtractedItem;
    const assignment: AssignmentProposal =
      decision.patch?.assignee != null
        ? { ...s.assignment, assignee: decision.patch.assignee }
        : s.assignment;
    await deps.recordEvent("approveSave", "end", { decision });
    const itemId = await saveItem(
      deps.supabase,
      deps.userId,
      deps.runId,
      item,
      assignment,
      s.input.source,
      s.input.imageUrl ?? null,
      s.input.sourceRef
    );
    return { extracted: item, assignment, itemId };
  });

  g.addNode("approveCalendar", async (s: S) => {
    if (!s.extracted) return {};
    const dueLike = s.extracted.due_at ?? s.extracted.expires_at ?? s.extracted.rsvp_by;
    if (!dueLike) return {};
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
    const proposal: ApprovalProposal = {
      kind: "create_calendar_event",
      summary,
      description,
      startISO,
      endISO,
    };
    await deps.recordEvent("approveCalendar", "interrupt", { proposal });
    const decision = interrupt({ key: "approveCalendar", proposal }) as
      | { action: "approve" | "reject"; patch?: { summary?: string; description?: string; startISO?: string; endISO?: string } }
      | undefined;
    if (!decision || decision.action === "reject") {
      await deps.recordEvent("approveCalendar", "end", { decision: decision ?? null, status: "rejected" });
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
    // Schedule nudge 1 day before due
    const dueMs = new Date(dueLike).getTime();
    if (Number.isNaN(dueMs)) return {};
    const nudgeAt = new Date(Math.max(Date.now() + 60_000, dueMs - 24 * 3600_000));
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
    (s: S) => (s.itemId ? "approveCalendar" : END),
    { approveCalendar: "approveCalendar" as never, [END]: END }
  );
  g.addEdge("approveCalendar" as never, "scheduleFollowup" as never);
  g.addEdge("scheduleFollowup" as never, END);

  return g.compile();
}

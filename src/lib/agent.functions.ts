// Public-facing server functions for the agent (RPC for the UI).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---- start a new run from an uploaded image ----
const StartFromImageInput = z.object({
  imageUrl: z.string().url(),
  storagePath: z.string().optional(),
  note: z.string().max(2000).optional(),
});

export const startRunFromImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StartFromImageInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const threadId = crypto.randomUUID();
    const noteText = data.note?.trim()
      ? `Additional context from the user about this image: ${data.note.trim()}\n\nExtract structured data from this document.`
      : null;
    const { data: run, error } = await supabase
      .from("agent_runs")
      .insert({
        user_id: userId,
        thread_id: threadId,
        status: "running",
        input_kind: "photo",
        input_ref: {
          input: { source: "photo", imageUrl: data.imageUrl, text: noteText, sourceRef: { storagePath: data.storagePath } },
          state: {},
        },
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { runAgent, emptyState } = await import("@/lib/agent/runtime.server");
    const state = emptyState({
      source: "photo",
      imageUrl: data.imageUrl,
      text: noteText,
      sourceRef: { storagePath: data.storagePath },
    });
    const result = await runAgent({ supabase, userId, runId: run.id, threadId, state });
    return {
      runId: run.id as string,
      status: result.pendingApproval ? "awaiting_approval" : result.errors.length > 0 ? "failed" : "done",
      error: result.errors[0]?.message ?? null,
    };
  });


// ---- start a run from arbitrary text (e.g. pasted email body) ----
const StartFromTextInput = z.object({ text: z.string().min(1).max(20_000) });
export const startRunFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StartFromTextInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const threadId = crypto.randomUUID();
    const { data: run, error } = await supabase
      .from("agent_runs")
      .insert({
        user_id: userId,
        thread_id: threadId,
        status: "running",
        input_kind: "text",
        input_ref: { input: { source: "photo", imageUrl: null, text: data.text, sourceRef: {} }, state: {} },
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const { runAgent, emptyState } = await import("@/lib/agent/runtime.server");
    const state = emptyState({ source: "photo", imageUrl: null, text: data.text, sourceRef: {} });
    const result = await runAgent({ supabase, userId, runId: run.id, threadId, state });
    return {
      runId: run.id as string,
      status: result.pendingApproval ? "awaiting_approval" : result.errors.length > 0 ? "failed" : "done",
      error: result.errors[0]?.message ?? null,
    };
  });

// ---- scan Gmail for the last 30 days, fan out a run per matching message ----
export const getGmailScanState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("gmail_scan_state")
      .select("last_scanned_at")
      .eq("user_id", userId)
      .maybeSingle();
    return { lastScannedAt: (data?.last_scanned_at as string | undefined) ?? null };
  });

export const scanGmailRecent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { gmailSearch, gmailGetMessage, gmailExtractBody } = await import("@/lib/agent/tools.server");
    const { runAgent, emptyState } = await import("@/lib/agent/runtime.server");

    // Look up the last scan time. If we've scanned before, only fetch messages
    // received after that timestamp so we don't redo work. First scan falls
    // back to the last 30 days.
    const { data: prevState } = await supabase
      .from("gmail_scan_state")
      .select("last_scanned_at")
      .eq("user_id", userId)
      .maybeSingle();
    const lastScannedAt = prevState?.last_scanned_at as string | undefined;
    const scanStartedAt = new Date();

    const timeFilter = lastScannedAt
      ? `after:${Math.floor(new Date(lastScannedAt).getTime() / 1000)}`
      : "newer_than:30d";

    const q = [
      timeFilter,
      "in:inbox",
      "-category:social",
      "-category:forums",
      "(",
      "receipt OR invoice OR order OR purchase OR payment OR bill OR statement OR due",
      "OR coupon OR promo OR sale OR discount OR offer",
      "OR rsvp OR invite OR invitation OR party OR event OR registration",
      "OR school OR teacher OR classroom OR practice OR rehearsal OR performance OR recital OR game OR tournament",
      "OR appointment OR reminder OR confirmation OR booking OR ticket",
      ")",
    ].join(" ");
    const list = await gmailSearch(q, 50);
    const ids = (list.messages ?? []).map((m) => m.id);
    const runIds: string[] = [];
    // Belt-and-suspenders dedupe: still skip any gmailId we've already processed.
    const { data: existing } = await supabase
      .from("agent_runs")
      .select("input_ref")
      .eq("user_id", userId)
      .eq("input_kind", "gmail")
      .order("started_at", { ascending: false })
      .limit(200);
    const seen = new Set<string>();
    for (const r of existing ?? []) {
      const gid = (r.input_ref as { input?: { sourceRef?: { gmailId?: string } } })?.input?.sourceRef?.gmailId;
      if (gid) seen.add(gid);
    }
    for (const id of ids) {
      if (seen.has(id)) continue;
      let text: string;
      try {
        const msg = await gmailGetMessage(id);
        const headers = Object.fromEntries(
          msg.payload.headers.map((h) => [h.name.toLowerCase(), h.value])
        );
        const body = gmailExtractBody(msg.payload) || msg.snippet || "";
        text = `From: ${headers["from"] ?? ""}\nSubject: ${headers["subject"] ?? ""}\nDate: ${headers["date"] ?? ""}\n\n${body}`;
      } catch {
        continue;
      }
      const threadId = crypto.randomUUID();
      const { data: run, error } = await supabase
        .from("agent_runs")
        .insert({
          user_id: userId,
          thread_id: threadId,
          status: "running",
          input_kind: "gmail",
          input_ref: { input: { source: "gmail", text, imageUrl: null, sourceRef: { gmailId: id } }, state: {} },
        })
        .select("id")
        .single();
      if (error) continue;
      runIds.push(run.id);
      const state = emptyState({ source: "gmail", text, imageUrl: null, sourceRef: { gmailId: id } });
      try {
        await runAgent({ supabase, userId, runId: run.id, threadId, state });
      } catch (e) {
        await supabase
          .from("agent_runs")
          .update({ status: "failed", error: (e as Error).message, ended_at: new Date().toISOString() })
          .eq("id", run.id);
      }
    }

    // Record this scan so the next one picks up only new mail.
    await supabase
      .from("gmail_scan_state")
      .upsert(
        { user_id: userId, last_scanned_at: scanStartedAt.toISOString(), updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );

    return {
      runIds,
      scanned: ids.length,
      skipped: ids.length - runIds.length,
      lastScannedAt: lastScannedAt ?? null,
      scannedAt: scanStartedAt.toISOString(),
    };
  });


// ---- resume a run with a decision on its pending approval ----
const ResumeInput = z.object({
  runId: z.string().uuid(),
  approvalId: z.string().uuid(),
  decision: z.object({
    action: z.enum(["approve", "edit", "reject"]),
    patch: z.record(z.string(), z.unknown()).optional(),
  }),
});
export const resumeRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ResumeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Load run + approval
    const [{ data: run, error: rErr }, { data: appr, error: aErr }] = await Promise.all([
      supabase.from("agent_runs").select("*").eq("id", data.runId).single(),
      supabase.from("approvals").select("*").eq("id", data.approvalId).single(),
    ]);
    if (rErr || !run) throw new Error("run not found");
    if (aErr || !appr) throw new Error("approval not found");
    if (appr.status !== "pending") throw new Error("approval already decided");

    // Mark approval decided
    const status = data.decision.action === "reject" ? "rejected" : data.decision.action === "edit" ? "edited" : "approved";
    await supabase
      .from("approvals")
      .update({ status, decision: JSON.parse(JSON.stringify(data.decision)), decided_at: new Date().toISOString() })
      .eq("id", data.approvalId);

    const { runAgent, rehydrateState } = await import("@/lib/agent/runtime.server");
    const state = rehydrateState((run.input_ref as Record<string, unknown>) ?? {});
    // record decision in state under the approval's node key
    state.decisions = { ...state.decisions, [appr.node]: data.decision as never };

    await supabase.from("agent_runs").update({ status: "running", current_node: null }).eq("id", data.runId);
    const result = await runAgent({ supabase, userId, runId: data.runId, threadId: run.thread_id, state });
    return { runId: data.runId, status: result.pendingApproval ? "awaiting_approval" : "done" };
  });

// ---- queries ----
export const listPendingApprovals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("approvals")
      .select("id, run_id, node, action_kind, proposal, created_at")
      .eq("status", "pending")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listRecentRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("agent_runs")
      .select("id, thread_id, status, input_kind, current_node, started_at, ended_at, error, langsmith_url")
      .is("deleted_at", null)
      .order("started_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ runId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [{ data: run }, { data: events }, { data: approvals }] = await Promise.all([
      context.supabase.from("agent_runs").select("*").eq("id", data.runId).maybeSingle(),
      context.supabase.from("agent_events").select("*").eq("run_id", data.runId).order("ts", { ascending: true }),
      context.supabase.from("approvals").select("*").eq("run_id", data.runId).order("created_at", { ascending: true }),
    ]);
    return { run, events: events ?? [], approvals: approvals ?? [] };
  });

export const listItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("items")
      .select("*")
      .eq("archived", false)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];

  });

// ---- calendar view: items with a date, joined with calendar event + followup status ----
export const listCalendarItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: items, error } = await supabase
      .from("items")
      .select("id, run_id, title, category, assignee, merchant, amount, currency, due_at, expires_at, rsvp_by")
      .eq("archived", false)
      .is("deleted_at", null)
      .or("due_at.not.is.null,expires_at.not.is.null,rsvp_by.not.is.null")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const list = items ?? [];
    const itemIds = list.map((i) => i.id);
    const runIds = Array.from(new Set(list.map((i) => i.run_id).filter(Boolean))) as string[];

    const [{ data: followups }, { data: calEvents }, { data: approvals }] = await Promise.all([
      itemIds.length
        ? supabase.from("followups").select("item_id, next_nudge_at, state").in("item_id", itemIds)
        : Promise.resolve({ data: [] as Array<{ item_id: string; next_nudge_at: string; state: string }> }),
      runIds.length
        ? supabase
            .from("agent_events")
            .select("run_id, payload, kind, node")
            .in("run_id", runIds)
            .eq("node", "approveCalendar")
            .eq("kind", "tool")
        : Promise.resolve({ data: [] as Array<{ run_id: string; payload: Record<string, unknown> }> }),
      runIds.length
        ? supabase
            .from("approvals")
            .select("run_id, status, action_kind")
            .in("run_id", runIds)
            .eq("action_kind", "create_calendar_event")
        : Promise.resolve({ data: [] as Array<{ run_id: string; status: string }> }),
    ]);

    const followupByItem = new Map(
      (followups ?? []).map((f) => [f.item_id, { at: f.next_nudge_at, state: f.state }])
    );
    const eventByRun = new Map(
      (calEvents ?? []).map((e) => [
        e.run_id,
        {
          eventId: (e.payload as { eventId?: string })?.eventId ?? null,
          link: (e.payload as { link?: string })?.link ?? null,
        },
      ])
    );
    const approvalByRun = new Map(
      (approvals ?? []).map((a) => [a.run_id, a.status])
    );

    return list.map((i) => ({
      ...i,
      calendar: i.run_id
        ? eventByRun.get(i.run_id) ?? { eventId: null, link: null }
        : { eventId: null, link: null },
      calendarApprovalStatus: i.run_id ? approvalByRun.get(i.run_id) ?? null : null,
      followup: followupByItem.get(i.id) ?? null,
    }));
  });

// ---- list upcoming events from connected Google Calendar (primary) ----
export const listGoogleCalendarEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const connKey = process.env.GOOGLE_CALENDAR_API_KEY;
    if (!lovableKey || !connKey) {
      return { connected: false as const, events: [] };
    }
    const now = new Date().toISOString();
    const url = new URL(
      "https://connector-gateway.lovable.dev/google_calendar/calendar/v3/calendars/primary/events"
    );
    url.searchParams.set("timeMin", now);
    url.searchParams.set("maxResults", "25");
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": connKey,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      return { connected: true as const, events: [], error: `${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        description?: string;
        htmlLink?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        reminders?: { useDefault?: boolean; overrides?: Array<{ method: string; minutes: number }> };
      }>;
    };
    return {
      connected: true as const,
      events: (data.items ?? []).map((e) => ({
        id: e.id,
        summary: e.summary ?? "(no title)",
        description: e.description ?? null,
        htmlLink: e.htmlLink ?? null,
        start: e.start?.dateTime ?? e.start?.date ?? null,
        end: e.end?.dateTime ?? e.end?.date ?? null,
        reminders: e.reminders ?? null,
      })),
    };
  });

// ---- delete an event from the connected Google Calendar (primary) ----
export const deleteGoogleCalendarEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ eventId: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const connKey = process.env.GOOGLE_CALENDAR_API_KEY;
    if (!lovableKey || !connKey) {
      throw new Error("Google Calendar is not connected.");
    }
    const url = `https://connector-gateway.lovable.dev/google_calendar/calendar/v3/calendars/primary/events/${encodeURIComponent(data.eventId)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": connKey,
      },
    });
    // 410 = already gone, 404 = not found — treat as success
    if (!res.ok && res.status !== 410 && res.status !== 404) {
      const body = await res.text();
      throw new Error(`Calendar delete failed (${res.status}): ${body.slice(0, 200)}`);
    }
    // Clear the linked item reference so the app stops pointing at a dead event
    await context.supabase
      .from("items")
      .update({ calendar_event_id: null })
      .eq("user_id", context.userId)
      .eq("calendar_event_id", data.eventId);
    return { ok: true as const };
  });


type AskMatch = {
  id: string;
  title: string;
  category: string;
  topic: string | null;
  assignee: string;
  merchant: string | null;
  amount: number | null;
  due_at: string | null;
  expires_at: string | null;
  status: string | null;
  completed_at: string | null;
  similarity: number;
};

async function answerFromMatches(question: string, matches: AskMatch[]): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const { generateText } = await import("ai");
  const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
  const gateway = createLovableAiGatewayProvider(key);

  const ctx = matches.length
    ? matches
        .map((m, i) =>
          `[${i + 1}] title="${m.title}" category=${m.category}` +
          (m.topic ? ` topic=${m.topic}` : "") +
          (m.merchant ? ` merchant=${m.merchant}` : "") +
          (m.amount != null ? ` amount=${m.amount}` : "") +
          (m.due_at ? ` due_at=${m.due_at}` : "") +
          (m.expires_at ? ` expires_at=${m.expires_at}` : "") +
          ` status=${m.status ?? "open"}` +
          (m.completed_at ? ` completed_at=${m.completed_at}` : "") +
          ` similarity=${m.similarity.toFixed(2)}`,
        )
        .join("\n")
    : "(no items found)";

  const { text } = await generateText({
    model: gateway("google/gemini-2.5-flash"),
    system:
      "You answer the user's question about their personal inbox of saved items. " +
      "Rules: (1) Answer ONLY what was asked, in one or two short sentences. " +
      "(2) Do not list unrelated items. (3) Use only the provided context — never invent facts. " +
      "(4) If the context does not contain the answer, reply exactly: NO_MATCH. " +
      "(5) For yes/no questions, start with Yes or No.",
    messages: [
      { role: "user", content: `Question: ${question}\n\nContext items:\n${ctx}` },
    ],
  });
  return text.trim();
}

export const askMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ q: z.string().min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { embedText } = await import("@/lib/ai-gateway.server");

    async function search(q: string): Promise<AskMatch[]> {
      const v = await embedText(q);
      const { data: matches, error } = await context.supabase.rpc("match_items", {
        query_embedding: v as unknown as string,
        match_count: 8,
      });
      if (error) throw new Error(error.message);
      return (matches ?? []) as AskMatch[];
    }

    const matches = await search(data.q);
    let answer = await answerFromMatches(data.q, matches);

    const promoLike = /\b(promo|promotion|coupon|discount|offer|sale|deal|gift\s*card)\b/i.test(data.q);
    let scanned = false;
    let matchesUsed = matches;

    if (answer === "NO_MATCH" && promoLike) {
      try {
        const { gmailSearch, gmailGetMessage, gmailExtractBody } = await import("@/lib/agent/tools.server");
        const { runAgent, emptyState } = await import("@/lib/agent/runtime.server");
        const q = `newer_than:30d in:inbox (coupon OR promo OR sale OR discount OR offer OR "gift card")`;
        const list = await gmailSearch(q, 25);
        const ids = (list.messages ?? []).map((m) => m.id);
        const { data: existing } = await context.supabase
          .from("agent_runs")
          .select("input_ref")
          .eq("user_id", context.userId)
          .eq("input_kind", "gmail")
          .order("started_at", { ascending: false })
          .limit(200);
        const seen = new Set<string>();
        for (const r of existing ?? []) {
          const gid = (r.input_ref as { input?: { sourceRef?: { gmailId?: string } } })?.input?.sourceRef?.gmailId;
          if (gid) seen.add(gid);
        }
        for (const id of ids) {
          if (seen.has(id)) continue;
          let text: string;
          try {
            const msg = await gmailGetMessage(id);
            const headers = Object.fromEntries(msg.payload.headers.map((h) => [h.name.toLowerCase(), h.value]));
            const body = gmailExtractBody(msg.payload) || msg.snippet || "";
            text = `From: ${headers["from"] ?? ""}\nSubject: ${headers["subject"] ?? ""}\nDate: ${headers["date"] ?? ""}\n\n${body}`;
          } catch {
            continue;
          }
          const threadId = crypto.randomUUID();
          const { data: run, error } = await context.supabase
            .from("agent_runs")
            .insert({
              user_id: context.userId,
              thread_id: threadId,
              status: "running",
              input_kind: "gmail",
              input_ref: { input: { source: "gmail", text, imageUrl: null, sourceRef: { gmailId: id } }, state: {} },
            })
            .select("id")
            .single();
          if (error) continue;
          const state = emptyState({ source: "gmail", text, imageUrl: null, sourceRef: { gmailId: id } });
          try {
            await runAgent({ supabase: context.supabase, userId: context.userId, runId: run.id, threadId, state });
          } catch (e) {
            await context.supabase
              .from("agent_runs")
              .update({ status: "failed", error: (e as Error).message, ended_at: new Date().toISOString() })
              .eq("id", run.id);
          }
        }
        scanned = true;
      } catch {
        // ignore scan failures; we'll still answer NO_MATCH
      }
      const fresh = await search(data.q);
      matchesUsed = fresh;
      answer = await answerFromMatches(data.q, fresh);
    }

    if (answer === "NO_MATCH") {
      answer = scanned
        ? "I couldn't find that — I also checked your recent Gmail and nothing matched."
        : "I couldn't find anything about that in your saved items.";
    }

    const sources = matchesUsed.filter((m) => m.similarity >= 0.3).slice(0, 3);
    return { answer, sources, scanned };
  });

export const listAssignmentRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("assignment_rules")
      .select("id, owner, keywords")
      .order("owner");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getStorageSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: signed, error } = await context.supabase.storage
      .from("receipts")
      .createSignedUrl(data.path, 60 * 60);
    if (error || !signed?.signedUrl) throw new Error(error?.message ?? "no signed url");
    return { url: signed.signedUrl };
  });

// ============================================================
// Item lifecycle: done / reschedule / cancel + notifications
// ============================================================

type ItemForLifecycle = {
  id: string;
  user_id: string;
  title: string;
  due_at: string | null;
  expires_at: string | null;
  rsvp_by: string | null;
  calendar_event_id: string | null;
  status: string;
  original_due_at: string | null;
  reschedule_count: number;
};

async function loadItem(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  itemId: string,
  userId: string,
): Promise<ItemForLifecycle> {
  const { data, error } = await supabase
    .from("items")
    .select("id, user_id, title, due_at, expires_at, rsvp_by, calendar_event_id, status, original_due_at, reschedule_count")
    .eq("id", itemId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "item not found");
  return data as ItemForLifecycle;
}

function dueFieldOf(item: ItemForLifecycle): "due_at" | "expires_at" | "rsvp_by" | null {
  if (item.due_at) return "due_at";
  if (item.expires_at) return "expires_at";
  if (item.rsvp_by) return "rsvp_by";
  return null;
}

export const markItemDone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ itemId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const item = await loadItem(supabase, data.itemId, userId);
    const now = new Date().toISOString();

    // Patch Google Calendar — mark cancelled (stops alerts) and prefix title with ✓
    if (item.calendar_event_id) {
      try {
        const { calendarPatchEvent } = await import("@/lib/agent/tools.server");
        await calendarPatchEvent(item.calendar_event_id, {
          summary: `✓ ${item.title}`,
          status: "cancelled",
        });
      } catch (e) {
        console.warn("calendar patch on done failed", (e as Error).message);
      }
    }

    await supabase
      .from("items")
      .update({ status: "done", completed_at: now })
      .eq("id", item.id);

    await supabase
      .from("followups")
      .update({ state: "acknowledged" })
      .eq("item_id", item.id)
      .eq("state", "scheduled");

    await supabase.from("notifications").insert({
      user_id: userId,
      item_id: item.id,
      kind: "win",
      title: "Nice work 🎉",
      body: `${item.title} — done`,
    });

    return { ok: true };
  });

export const rescheduleItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ itemId: z.string().uuid(), newDateISO: z.string().min(8) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const item = await loadItem(supabase, data.itemId, userId);
    const field = dueFieldOf(item);
    if (!field) throw new Error("item has no date to reschedule");
    const newDate = new Date(data.newDateISO);
    if (Number.isNaN(newDate.getTime())) throw new Error("invalid date");
    const newISO = newDate.toISOString();
    const endISO = new Date(newDate.getTime() + 30 * 60_000).toISOString();

    if (item.calendar_event_id) {
      try {
        const { calendarPatchEvent } = await import("@/lib/agent/tools.server");
        await calendarPatchEvent(item.calendar_event_id, { startISO: newISO, endISO });
      } catch (e) {
        console.warn("calendar patch on reschedule failed", (e as Error).message);
      }
    }

    const original = item.original_due_at ?? item[field];
    const patch: Record<string, unknown> = {
      [field]: newISO,
      original_due_at: original,
      reschedule_count: (item.reschedule_count ?? 0) + 1,
    };
    await supabase.from("items").update(patch as never).eq("id", item.id);

    // Reschedule any active followup to 24h before the new date
    const nextNudge = new Date(newDate.getTime() - 24 * 60 * 60_000).toISOString();
    await supabase
      .from("followups")
      .update({ next_nudge_at: nextNudge, state: "scheduled", attempts: 0 })
      .eq("item_id", item.id);

    return { ok: true };
  });

export const cancelItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ itemId: z.string().uuid(), reason: z.string().max(200).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const item = await loadItem(supabase, data.itemId, userId);
    const now = new Date().toISOString();

    if (item.calendar_event_id) {
      try {
        const { calendarDeleteEvent } = await import("@/lib/agent/tools.server");
        await calendarDeleteEvent(item.calendar_event_id);
      } catch (e) {
        console.warn("calendar delete on cancel failed", (e as Error).message);
      }
    }

    await supabase
      .from("items")
      .update({ status: "cancelled", cancelled_at: now })
      .eq("id", item.id);

    await supabase
      .from("followups")
      .update({ state: "dismissed" })
      .eq("item_id", item.id)
      .eq("state", "scheduled");

    return { ok: true };
  });

export const listWins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("items")
      .select("id, title, category, assignee, merchant, amount, currency, due_at, expires_at, rsvp_by, original_due_at, completed_at, reschedule_count")
      .eq("status", "done")
      .is("deleted_at", null)
      .order("completed_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("notifications")
      .select("id, item_id, kind, title, body, read_at, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid().optional(), all: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    if (data.all) {
      await context.supabase.from("notifications").update({ read_at: now }).is("read_at", null);
    } else if (data.id) {
      await context.supabase.from("notifications").update({ read_at: now }).eq("id", data.id);
    }
    return { ok: true };
  });

// ============================================================
// Soft delete + restore + trash views + bulk clear
// ============================================================

const IdInput = z.object({ id: z.string().uuid() });

export const softDeleteItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // best-effort: clear linked calendar event so reminders stop
    const { data: row } = await supabase
      .from("items")
      .select("calendar_event_id, title")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (row?.calendar_event_id) {
      try {
        const { calendarPatchEvent } = await import("@/lib/agent/tools.server");
        await calendarPatchEvent(row.calendar_event_id as string, { status: "cancelled" });
      } catch (e) {
        console.warn("calendar clear on delete failed", (e as Error).message);
      }
    }
    const { error } = await supabase
      .from("items")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const restoreItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("items")
      .update({ deleted_at: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const softDeleteApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("approvals")
      .update({ deleted_at: new Date().toISOString(), status: "rejected" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const softDeleteRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    await context.supabase.from("approvals").update({ deleted_at: now }).eq("run_id", data.id);
    const { error } = await context.supabase
      .from("agent_runs")
      .update({ deleted_at: now })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const softDeleteNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notifications")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- bulk clears (all soft) ----
export const clearCancelledItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("items")
      .update({ deleted_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .eq("status", "cancelled")
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const clearReadNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("notifications")
      .update({ deleted_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .not("read_at", "is", null)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const clearFinishedRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("agent_runs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .in("status", ["done", "failed", "cancelled"])
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const rejectAllApprovals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("approvals")
      .update({
        status: "rejected",
        decided_at: new Date().toISOString(),
        deleted_at: new Date().toISOString(),
      })
      .eq("user_id", context.userId)
      .eq("status", "pending")
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- trash view: items only (everything else stays out of sight) ----
export const listTrashedItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("items")
      .select("*")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const emptyTrash = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, supabase } = context;
    // Hard-delete soft-deleted rows across all surfaces
    const where = (tbl: "items" | "approvals" | "agent_runs" | "notifications") =>
      supabase.from(tbl).delete().eq("user_id", userId).not("deleted_at", "is", null);
    await Promise.all([where("items"), where("approvals"), where("agent_runs"), where("notifications")]);
    return { ok: true };
  });

export const deleteTrashedItemForever = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("items")
      .delete()
      .eq("id", data.id)
      .not("deleted_at", "is", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


// ---- edit an item's user-facing fields (and patch the linked calendar event) ----
const UpdateItemInput = z.object({
  itemId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  merchant: z.string().max(200).nullable().optional(),
  amount: z.number().nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  assignee: z.enum(["mom", "dad", "either"]).optional(),
  due_at: z.string().nullable().optional(),
});
export const updateItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateItemInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: cur, error: loadErr } = await supabase
      .from("items")
      .select("id, calendar_event_id, due_at, expires_at, rsvp_by, title")
      .eq("id", data.itemId)
      .eq("user_id", userId)
      .maybeSingle();
    if (loadErr || !cur) throw new Error(loadErr?.message ?? "item not found");

    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.merchant !== undefined) patch.merchant = data.merchant;
    if (data.amount !== undefined) patch.amount = data.amount;
    if (data.description !== undefined) patch.description = data.description;
    if (data.assignee !== undefined) patch.assignee = data.assignee;

    // Route the date update to whichever date field this item uses.
    let newDateISO: string | null | undefined;
    if (data.due_at !== undefined) {
      const field = cur.due_at ? "due_at" : cur.expires_at ? "expires_at" : cur.rsvp_by ? "rsvp_by" : "due_at";
      patch[field] = data.due_at;
      newDateISO = data.due_at;
    }

    const { error: upErr } = await supabase.from("items").update(patch as never).eq("id", data.itemId);
    if (upErr) throw new Error(upErr.message);

    // Best-effort sync to Google Calendar.
    if (cur.calendar_event_id && (data.title !== undefined || data.description !== undefined || newDateISO !== undefined)) {
      try {
        const { calendarPatchEvent } = await import("@/lib/agent/tools.server");
        const calPatch: Parameters<typeof calendarPatchEvent>[1] = {};
        if (data.title !== undefined) calPatch.summary = data.title;
        if (data.description !== undefined) calPatch.description = data.description ?? "";
        if (newDateISO) {
          calPatch.startISO = newDateISO;
          calPatch.endISO = new Date(new Date(newDateISO).getTime() + 30 * 60_000).toISOString();
        } else if (newDateISO === null) {
          // clearing the date — cancel the linked event so reminders stop
          calPatch.status = "cancelled";
        }
        await calendarPatchEvent(cur.calendar_event_id as string, calPatch);
      } catch (e) {
        console.warn("calendar patch on edit failed", (e as Error).message);
      }
    }
    return { ok: true };
  });

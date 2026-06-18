// Public-facing server functions for the agent (RPC for the UI).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---- start a new run from an uploaded image ----
const StartFromImageInput = z.object({
  imageUrl: z.string().url(),
  storagePath: z.string().optional(),
});

export const startRunFromImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StartFromImageInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const threadId = crypto.randomUUID();
    const { data: run, error } = await supabase
      .from("agent_runs")
      .insert({
        user_id: userId,
        thread_id: threadId,
        status: "running",
        input_kind: "photo",
        input_ref: {
          input: { source: "photo", imageUrl: data.imageUrl, text: null, sourceRef: { storagePath: data.storagePath } },
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
      text: null,
      sourceRef: { storagePath: data.storagePath },
    });
    const result = await runAgent({ supabase, userId, runId: run.id, threadId, state });
    return { runId: run.id as string, status: result.pendingApproval ? "awaiting_approval" : "done" };
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
    return { runId: run.id as string, status: result.pendingApproval ? "awaiting_approval" : "done" };
  });

// ---- scan Gmail for the last 30 days, fan out a run per matching message ----
export const scanGmailRecent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { gmailSearch, gmailGetMessage } = await import("@/lib/agent/tools.server");
    const { runAgent, emptyState } = await import("@/lib/agent/runtime.server");
    const q = "newer_than:30d (receipt OR invoice OR coupon OR promo OR bill OR rsvp OR invite OR \"order confirmation\")";
    const list = await gmailSearch(q, 15);
    const ids = (list.messages ?? []).slice(0, 10).map((m) => m.id);
    const runIds: string[] = [];
    for (const id of ids) {
      const msg = await gmailGetMessage(id);
      const headers = Object.fromEntries(msg.payload.headers.map((h) => [h.name.toLowerCase(), h.value]));
      const text = `From: ${headers["from"] ?? ""}\nSubject: ${headers["subject"] ?? ""}\nDate: ${headers["date"] ?? ""}\n\n${msg.snippet ?? ""}`;
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
      await runAgent({ supabase, userId, runId: run.id, threadId, state });
    }
    return { runIds, scanned: ids.length };
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

export const askMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ q: z.string().min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { embedText } = await import("@/lib/ai-gateway.server");
    const v = await embedText(data.q);
    const { data: matches, error } = await context.supabase.rpc("match_items", {
      query_embedding: v as unknown as string,
      match_count: 8,
    });
    if (error) throw new Error(error.message);
    return matches ?? [];
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
    await supabase.from("items").update(patch).eq("id", item.id);

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

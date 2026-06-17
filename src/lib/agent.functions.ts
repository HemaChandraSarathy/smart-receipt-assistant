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

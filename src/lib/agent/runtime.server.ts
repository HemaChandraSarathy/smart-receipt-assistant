// Server-only runtime that wires the graph into the rest of the app:
// - starts a run, persists state, records events
// - resumes with a decision and re-invokes
// - exposes a record-event helper that LangSmith picks up via env

import { Client as LangSmithClient } from "langsmith";
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildGraph, type AgentState, type InitialInput } from "./graph.server";
import type { ApprovalProposal } from "./types";
import type { DecisionLog } from "./graph.server";

const LANGSMITH_PROJECT = process.env.LANGSMITH_PROJECT || "receipts-agent";

let langsmith: LangSmithClient | null = null;
function getLangSmith(): LangSmithClient | null {
  if (!process.env.LANGSMITH_API_KEY) return null;
  if (!langsmith) {
    langsmith = new LangSmithClient({ apiKey: process.env.LANGSMITH_API_KEY });
  }
  return langsmith;
}

export function langsmithProjectUrl(threadId: string): string | null {
  if (!process.env.LANGSMITH_API_KEY) return null;
  return `https://smith.langchain.com/o/-/projects/p/${encodeURIComponent(LANGSMITH_PROJECT)}?metadataKey=thread_id&metadataValue=${encodeURIComponent(threadId)}`;
}

export async function runAgent(args: {
  supabase: SupabaseClient;
  userId: string;
  runId: string;
  threadId: string;
  state: AgentState;
}): Promise<AgentState> {
  const { supabase, userId, runId, threadId, state } = args;

  // Load assignment rules
  const { data: rules } = await supabase
    .from("assignment_rules")
    .select("owner, keywords")
    .eq("user_id", userId);

  const ls = getLangSmith();
  const lsRun = ls
    ? await ls
        .createRun({
          name: "receipts-agent",
          run_type: "chain",
          inputs: { input: state.input, decisions: state.decisions },
          project_name: LANGSMITH_PROJECT,
          extra: { metadata: { thread_id: threadId, run_id: runId, user_id: userId } },
        })
        .catch(() => null)
    : null;

  const recordEvent = async (
    node: string,
    kind: "start" | "end" | "tool" | "error" | "interrupt" | "retry",
    payload: Record<string, unknown>
  ) => {
    await supabase.from("agent_events").insert({
      run_id: runId,
      user_id: userId,
      node,
      kind,
      payload,
    });
  };

  const writeApproval = async (
    key: string,
    node: string,
    actionKind: string,
    proposal: ApprovalProposal
  ) => {
    // upsert-ish: skip if a pending one already exists for this (run, key)
    const { data: existing } = await supabase
      .from("approvals")
      .select("id")
      .eq("run_id", runId)
      .eq("node", key)
      .eq("status", "pending")
      .maybeSingle();
    if (existing) return;
    await supabase.from("approvals").insert({
      run_id: runId,
      user_id: userId,
      node: key,
      action_kind: actionKind,
      proposal: proposal as unknown as Record<string, unknown>,
      status: "pending",
    });
  };

  const graph = buildGraph(
    { supabase, userId, runId, recordEvent, writeApproval },
    (rules ?? []).map((r) => ({ owner: r.owner, keywords: r.keywords ?? [] }))
  );

  const result = (await graph.invoke(state)) as AgentState;

  // Persist updated state
  const newStatus = result.pendingApproval
    ? "awaiting_approval"
    : result.errors.length > 0
      ? "failed"
      : "done";
  await supabase
    .from("agent_runs")
    .update({
      status: newStatus,
      current_node: result.pendingApproval ?? null,
      input_ref: JSON.parse(
        JSON.stringify({ input: result.input, state: stripStateForStorage(result) })
      ),
      ended_at: newStatus === "awaiting_approval" ? null : new Date().toISOString(),
      error: result.errors[0]?.message ?? null,
      langsmith_url: langsmithProjectUrl(threadId),
    })
    .eq("id", runId);

  const lsRunId = (lsRun as { id?: string } | null)?.id;
  if (lsRunId && ls) {
    await ls
      .updateRun(lsRunId, {
        outputs: { state: stripStateForStorage(result), status: newStatus },
        end_time: Date.now(),
      })
      .catch(() => null);
  }

  return result;
}

function stripStateForStorage(s: AgentState) {
  return {
    extracted: s.extracted,
    assignment: s.assignment,
    itemId: s.itemId,
    calendarEventId: s.calendarEventId,
    decisions: s.decisions,
    pendingApproval: s.pendingApproval,
    errors: s.errors,
  };
}

export function emptyState(input: InitialInput): AgentState {
  return {
    input,
    extracted: null,
    assignment: null,
    itemId: null,
    calendarEventId: null,
    decisions: {} as DecisionLog,
    pendingApproval: null,
    errors: [],
  };
}

export function rehydrateState(input_ref: Record<string, unknown>): AgentState {
  const input = (input_ref?.input ?? {}) as InitialInput;
  const s = (input_ref?.state ?? {}) as Partial<AgentState>;
  return {
    input,
    extracted: s.extracted ?? null,
    assignment: s.assignment ?? null,
    itemId: s.itemId ?? null,
    calendarEventId: s.calendarEventId ?? null,
    decisions: s.decisions ?? ({} as DecisionLog),
    pendingApproval: null, // cleared on resume
    errors: s.errors ?? [],
  };
}

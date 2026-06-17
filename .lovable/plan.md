
# Receipts Agent — LangGraph.js Plan

## Goal

Replace one-shot LLM calls with a real **agent**: a `StateGraph` that decides
the next node, calls tools, persists state between steps, retries on tool
failure, and **pauses for your approval before any external action**
(calendar create, email send, task assign, follow-up nag). All traced to
LangSmith.

## Architecture

```text
┌─────────── React (TanStack) ───────────┐
│  Upload photo / Scan Gmail / Inbox /   │
│  Approval Queue / Run Timeline         │
└──────────────┬─────────────────────────┘
               │ useServerFn
┌──────────────▼─────────────────────────┐
│  Server functions (CF Workers)         │
│   - startRun(input)                    │
│   - resumeRun(runId, decision)         │
│   - getRun(runId), listPendingApprov() │
└──────────────┬─────────────────────────┘
               │
┌──────────────▼─────────────────────────┐
│  LangGraph.js StateGraph               │
│   nodes: ingest → categorize → topic   │
│          → extract → assign            │
│          → [HITL] → side-effects       │
│          → memorize → schedule-followup│
│   checkpointer: Postgres (Cloud)       │
│   tracer: LangSmith                    │
└──────────────┬─────────────────────────┘
               │
┌──────────────▼─────────────────────────┐
│  Tools                                 │
│   visionExtract  (Lovable AI Gemini)   │
│   gmailSearch    (connector gateway)   │
│   gmailGetMsg    (connector gateway)   │
│   calendarCreate (connector gateway)   │
│   dbWriteItem    (Supabase)            │
│   dbSemanticSearch (pgvector)          │
│   sendReminderEmail (Lovable Email)    │
└────────────────────────────────────────┘
```

## The Graph

Nodes (each is short — Workers have no persistent process; the checkpointer
lets the graph resume across invocations):

1. **ingest** — normalize input (uploaded image, or one Gmail message)
2. **categorize** — bill / promo / coupon / invite / receipt (+ confidence)
3. **topic** — "HVAC promo", "medical bill", "theatre RSVP", etc.
4. **extract** — merchant, amount, due/expiry date, RSVP-by, raw text
5. **assign** — Mom vs Dad from your responsibility map; low-confidence → ask
6. **approvalGate** (HITL) — `interrupt()` with a proposal payload
7. **sideEffects** (parallel branch after approval)
   - `calendarCreate` for due dates / expiries / RSVPs
   - `dbWriteItem` (persist final item)
   - `memorize` (embedding into pgvector for "do I have a plumbing coupon?")
8. **scheduleFollowup** — write a row that the daily cron will pick up
9. **end** — emit run summary

Conditional edges:
- `categorize.confidence < 0.6` → loop back with vision tool at higher detail
- `assign.confidence < 0.7` → route to HITL with "who owns this?" question
- any tool error → `retryNode` (exponential backoff, max 3) → if still failing
  → HITL with the error and a "skip / retry / edit" choice

Reducers on state: `messages` (append), `toolCalls` (append),
`errors` (append), `proposals` (replace), `decisions` (append).

## Human-in-the-Loop

LangGraph `interrupt()` halts the run and persists state. The server fn
returns `{ status: "awaiting_approval", runId, proposal }`. UI shows a
**Pending Approvals** screen; you Approve / Edit / Reject. `resumeRun`
calls `graph.invoke(null, { configurable: { thread_id: runId } })` with
the `Command({ resume: decision })` payload, the graph picks up at the
exact node, and only then does any external write happen.

Approval points (per your answer "approve before any external action"):
- Before `calendarCreate`
- Before `sendReminderEmail` (both initial nudge schedule and each daily fire)
- Before final `dbWriteItem` on first-time topic/assignee mappings

## Schema (Lovable Cloud / Postgres)

- `agent_runs` — id, thread_id, status (running/awaiting/done/failed),
  input_kind, input_ref, started_at, ended_at, langsmith_url
- `agent_checkpoints` — managed by LangGraph's Postgres checkpointer
  (`PostgresSaver`); one row per super-step per thread
- `agent_events` — id, run_id, node, kind (start/end/tool/error/interrupt),
  payload jsonb, ts (powers the in-app timeline)
- `approvals` — id, run_id, node, proposal jsonb, status
  (pending/approved/edited/rejected), decided_by, decided_at, decision jsonb
- `items` — final receipts/promos/bills (category, topic, assignee, amount,
  due_at, expires_at, merchant, image_url, source: photo|gmail, raw jsonb,
  embedding vector(768))
- `assignment_rules` — owner, keywords[] (seeded with your Mom/Dad map; the
  assign node consults this + LLM)
- `followups` — item_id, next_nudge_at, channel (email/in_app), state
- pgvector extension on `items.embedding` for semantic memory query

All RLS-scoped to `auth.uid()`; grants per Cloud rules.

## Tools (LangChain `tool()` wrappers)

Each tool is a thin TS function with a Zod input schema, called from inside a
node. Failures throw a typed `ToolError` the graph catches.

- **visionExtract** → Lovable AI Gateway, `google/gemini-2.5-pro` with image
  input, returns structured JSON via AI SDK `Output.object`
- **gmailSearch / gmailGetMessage** → connector gateway
  `https://connector-gateway.lovable.dev/google_mail/gmail/v1/...`
- **calendarCreate** → connector gateway `/google_calendar/calendar/v3/...`
  (guarded behind approval gate)
- **dbWriteItem / dbSemanticSearch** → Supabase via `requireSupabaseAuth`
  context inside the server fn
- **embedText** → Lovable AI embeddings endpoint
- **sendReminderEmail** → Lovable Email (set up if/when you enable email
  domain; otherwise in-app only for v1)

## Observability

- LangSmith tracer wired on the graph; every run gets a shareable trace URL
  stored on `agent_runs.langsmith_url`
- In-app **Run Timeline** reads `agent_events` and renders node-by-node with
  inputs, outputs, tool calls, errors, and approval decisions
- LangSmith API key requested via `add_secret` as `LANGSMITH_API_KEY` (plus
  `LANGSMITH_PROJECT`) when we start build

## UI Surfaces (new)

- **Capture** — snap/upload photo OR "Scan Gmail (last 30 days)" button →
  spawns one run per item
- **Pending Approvals** — queue of `interrupt()`s with proposed action,
  source preview, edit form, Approve/Reject
- **Inbox** — final items grouped by assignee, filterable by category/topic,
  with due/expiry badges
- **Run Timeline** — per-run graph trace + LangSmith deep link
- **Ask** — chat box that runs semantic search over `items` ("do I have a
  plumbing coupon?")

## Prerequisites (handled at start of build)

- Connect **Gmail** and **Google Calendar** connectors (the earlier Gmail
  connect was interrupted — I'll redo both)
- Add secrets: `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`
- Install: `@langchain/core`, `@langchain/langgraph`,
  `@langchain/langgraph-checkpoint-postgres`, `langsmith`, `zod`, `pg`
- Enable `pgvector` extension; create tables + RLS + grants

## Build Order

1. Design system + auth (email + Google) + PWA manifest
2. DB schema + RLS + pgvector + seed `assignment_rules` from your Mom/Dad map
3. Connect Gmail + Calendar; verify with one gateway call each
4. Agent core: state shape, checkpointer, LangSmith tracer, `startRun` /
   `resumeRun` server fns
5. Nodes + tools, one at a time, each with a smoke test:
   ingest → categorize → topic → extract → assign → approvalGate →
   sideEffects → memorize → scheduleFollowup
6. UI: Capture, Pending Approvals, Inbox, Run Timeline, Ask
7. Daily follow-up cron (`pg_cron` → `/api/public/hooks/run-followups`) that
   spawns follow-up runs (which also hit the approval gate before sending)

## Explicitly Out of Scope for v1

- Native iOS/Android (PWA only)
- Outlook / iCloud
- Auto-paying bills
- Multi-tenant household sharing UI (single household, you + husband as two
  assignee values — sharing UI can come later)
- Voice input

## Key Trade-offs to Know

- **Cloudflare Workers are stateless.** The graph runs one logical phase per
  server-fn invocation; the Postgres checkpointer is what makes "agent that
  holds state across steps" possible. Long single calls will hit Worker CPU
  limits, so nodes stay small and the graph fans out across invocations.
- **LangGraph.js < LangGraph Python** in feature parity. We get StateGraph,
  checkpointers, interrupts, conditional edges, tool nodes, LangSmith
  tracing. We do NOT get the Python-only LangGraph Cloud control plane — the
  in-app Run Timeline + LangSmith fill that role.

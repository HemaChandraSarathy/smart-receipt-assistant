
# Unburden — Week 3 Project Documentation

Produce a single deliverable: **`Unburden_Project_Documentation.docx`** (downloadable from `/mnt/documents/`), modeled on the Market Research Agent example you attached, and tied explicitly to every artefact the Week 3 handout asks for.

## What goes in the doc

Structured to mirror the example's "Solution Kit — Architecture" shape, with extra sections the handout requires (datasets, vibe-coding prompts, iterations, learnings).

1. **Cover** — "Unburden — Your Mental Inbox" / Week 3 Project / Bring-Your-Own Use Case / Code Track (LangChain + LangGraph).
2. **The Primer (one-liner)** — filled-in version of the handout's primer sentence: *"Unburden helps busy parents do the mental-inbox work (capture → extract → assign → schedule → follow up) in a web/PWA app, replacing the mental load of tracking bills/promos/invites in their head. It does extraction, owner assignment, calendar creation, and ask-Q&A on its own using ~6 tools, hands off to a human via the Approvals queue for any write to Google Calendar or outbound reminder, and I'll know it works when a parent can capture an item and see it scheduled in under 30 s with ≥80% correct owner assignment on the golden set."*
3. **Agent Framework table** — every row from the handout (User, Surface, Tools, Memory, Never-do, Human-in-the-loop, Failure handling, Success metric) filled for Unburden.
4. **Project Overview** (handout deliverable) — what Unburden is, who it's for, what it replaces.
5. **The Solution We Built** — paragraph mirroring example §1: LangGraph graph with Extract → Assign → (HITL) → Save → Schedule → Notify nodes, plus an Ask sub-flow with Gmail fallback.
6. **Architecture Overview (ASCII diagram)** — User → Capture UI → server function → LangGraph orchestrator → tools (Lovable AI Gateway · Supabase · Google Calendar · Gmail · LangSmith) → Approvals queue → Inbox/Calendar UI.
7. **Node table** (mirrors example p.4 table) — columns: Node ID · Name · Type · LLM Calls · Description. Rows: `extract_node`, `assign_node`, `approval_gate`, `save_item_node`, `schedule_node`, `notify_node`, `ask_node`, `gmail_fallback_node`.
8. **Shared state** — `AgentState` TypedDict fields: `input`, `extracted`, `assignment`, `itemId`, `calendarEventId`, `decisions`, `pendingApproval`, `errors` (cite `src/lib/agent/graph.server.ts` + `runtime.server.ts`).
9. **External dependencies** — Lovable AI Gateway (Gemini 2.5 Flash, extraction + answering, embeddings), Supabase (Postgres + pgvector + RLS + Auth + Storage), Google Calendar API, Gmail API, LangGraph (checkpointing + interrupts), LangSmith (traces).
10. **Node Deep Dives** (§2 in example) — one subsection per node with key implementation details and the actual Zod / Pydantic-equivalent schema for `ExtractedItem`, `AssignmentProposal`, `ApprovalProposal` (from `src/lib/agent/types.ts`).
11. **Key Design Decisions** — table: Decision · Alternative rejected · Rationale. Rows: LangGraph over single ReAct loop; HITL gate on every external write; pgvector + Gmail fallback for Ask instead of pure RAG; "date_known=false / due_at=null" anti-hallucination rule; storing roles in `user_roles` not on profile; Lovable AI Gateway over direct OpenAI.
12. **Three Agent Strategies Compared** (mirrors example §3) — Sequential graph (chosen) vs Parallel specialists vs ReAct orchestrator, with dimensions: speed, determinism, LLM cost, debuggability, fit for HITL.
13. **Prompts** (§4 in example) — verbatim system prompts for the Extractor, Assigner, and Ask answerer, plus the Gmail-fallback prompt.
14. **Datasets used** (handout deliverable) — golden examples table (curated input → expected `ExtractedItem`), Gmail promo corpus (scanned at query time, not stored), assignment-rules table seeded per user.
15. **Vibe-coding prompts used** (handout deliverable) — 8-10 representative Lovable prompts that built the app (scaffold inbox, add Google Calendar two-way sync, add Approvals queue, add Ask with Gmail fallback, add golden eval page, etc.).
16. **Iterations tried** (handout deliverable) — what was thrown away: first cut had no HITL → too many wrong calendar events; first Ask answered from LLM memory → swapped to grounded retrieval + Gmail fallback; first owner-assignment was prompt-only → added `assignment_rules` table; date-hallucination → added `date_known` + `due_at_hint`.
17. **Learnings & Observations** (handout deliverable) — control flow is harder than prompts (matches handout's framing); interrupts + a typed `ApprovalProposal` made HITL trivial; LangSmith traces caught the date-hallucination class of bugs; eval golden set is what made the agent actually shippable.
18. **How to run** — short pointer to README (`bun install && bun dev`, Lovable Cloud auto-manages env).
19. **Submission checklist** — maps each handout deliverable (project doc, demo video, GitHub link) to where to find it.

## Technical implementation

- Generate with **`docx`** npm package (already in skill instructions). Bundled-script-free Node run via `bun`.
- Page size US Letter, 1" margins, Arial 11pt body, Arial bold for headings, semantic `HeadingLevel.HEADING_1/2/3`.
- Tables use DXA widths and `ShadingType.CLEAR` per the docx skill.
- Bulleted lists use `LevelFormat.BULLET` (no unicode bullets).
- ASCII architecture diagram in a monospaced code-block paragraph (Courier New).
- Output path: `/mnt/documents/Unburden_Project_Documentation.docx`. Validate with the skill's `validate_document.py`.
- Also drop a plain-text mirror at `/mnt/documents/Unburden_Project_Documentation.md` so you can paste into Google Docs if preferred.
- No app code changes. Nothing under `src/` is touched.

## Out of scope

- No demo video script (the handout asks you to record one; I can write a script in a follow-up if you want).
- No edits to `README.md` (already in place).

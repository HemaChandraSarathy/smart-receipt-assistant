## Photo → parsed → assigned → calendar → reminder → searchable

```
Capture → Extract → Categorize → Assign → [Approve?] → Save → Calendar → Follow-up → Searchable
  📷       👁️         🏷️         👤        ✋          💾      📅          🔔         🔍
```

### Flow

1. **Capture** (`/capture`) — image uploaded to private `receipts` bucket only long enough for the AI to read it (signed URL, 1h TTL).
2. **Extract** — Gemini 2.5 Flash via Lovable AI Gateway: category, title, merchant, amount, currency, due_at / expires_at / rsvp_by, description, raw_text, `category_confidence`.
3. **Categorize** — bill | promo | coupon | invite | receipt | other.
4. **Assign** — keyword rules in `assignment_rules` (Mom/Dad, already seeded) → `assignee` + confidence + reasoning.
5. **Human-in-loop (Save gate)**:
   - `category_confidence ≥ 0.85` AND `assignment.confidence ≥ 0.85` → auto-approve.
   - Otherwise → pending card in `/approvals` (approve / edit / reject).
6. **Save** — row inserted into `items` (parsed fields only). **Image deleted from storage right after extract.** `image_url` stays null.
7. **Calendar** — if any date present, create event on connected Google account's primary calendar. Always requires approval.
8. **Follow-up** — nudge scheduled 24h before due/expires/rsvp; in-app reminder for the assigned parent.
9. **Search** — `/ask` already does keyword + semantic search via pgvector (`match_items` RPC, Gemini embeddings).

### Backend

Already in place on Lovable Cloud (Supabase + pgvector): `items`, `agent_runs`, `agent_events`, `approvals`, `followups`, `assignment_rules`. All RLS-scoped to your user. LangGraph orchestrates the nodes; LangSmith traces every run automatically.

### Sequential agent visibility

Restructure `/runs/$runId` as a vertical timeline so each agent step is visible one by one:

```
✅ Extract        Gemini 2.5 Flash · 1.4s · conf 0.92
✅ Categorize     bill
✅ Assign         dad · conf 0.88 · "matched: hvac"
⏳ Save           awaiting your approval   [Approve] [Edit] [Reject]
⚪ Calendar       (waiting)
⚪ Follow-up      (waiting)
```

Each node shows: agent name, model (when AI), duration, confidence, collapsible input/output, retry/error state. `/approvals` continues to list every pending gate across all runs.

### Image-retention changes

- After `visionExtract` (success or terminal fail), delete the object at `storagePath`.
- `saveItem()` always writes `image_url: null`.

### Confidence auto-run

- `AUTO_APPROVE_THRESHOLD = 0.85` in graph.
- `approveSave` skips approval when both confidences ≥ threshold.
- `approveCalendar` always requires approval.

### Files to change

- `src/lib/agent/graph.server.ts` — auto-approve threshold; delete-image step after extract.
- `src/lib/agent/tools.server.ts` — `deleteStorageObject(path)` helper.
- `src/lib/agent.functions.ts` — pass `storagePath` through; ensure deletion runs on extract error too.
- `src/routes/_authenticated/runs.$runId.tsx` — sequential agent timeline.
- `src/routes/_authenticated/capture.tsx` — copy note: "Photo is deleted after parsing — only the parsed details are kept."

### Not changing

Auth, Gmail scan, `/ask` semantic search, DB schema, RLS, calendar connector, models, LangGraph/LangSmith wiring.

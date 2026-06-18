# Golden dataset for the extractor

A small, growing library of "this is what a human would have extracted" examples. We store the source image + the ideal multi-task output + notes about what's tricky. Two payoffs:

1. **Few-shot the live extractor** — inject 1–2 most-relevant examples into the vision prompt so it stops collapsing multi-task documents into one item and stops hallucinating dates.
2. **Eval harness** — re-run the current extractor against every golden example on demand and see a pass/fail diff.

You add new examples from the app; no code change needed each time.

## What ships in v1

### 1. Database (migration)

New table `golden_examples`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid | who added it |
| `title` | text | "Main Street Theater flyer" |
| `image_url` | text | stored permanently in `golden/` storage bucket (never auto-deleted) |
| `source_text` | text | optional verbatim transcript |
| `notes` | text | "no date on doc, only 'Friday'; multi-task" |
| `expected_items` | jsonb | array of ideal items (see shape below) |
| `expected_clarifications` | jsonb | array of `{ question, options? }` the agent should have asked |
| `failure_tags` | text[] | e.g. `['hallucinated_date','missed_multi_task','dropped_context']` |
| `created_at` | timestamptz | |

`expected_items[]` shape (mirrors `ExtractedItem` + a `source_quote` per field and an explicit `date_known` flag):

```json
{
  "title": "Pay $5 for Friday pizza lunch",
  "category": "bill",
  "amount": 5,
  "due_at": null,
  "due_at_hint": "Thursday",
  "date_known": false,
  "description": "Pepperoni/cheese & cheese only; 2 slices, 3 if extras.",
  "source_quote": "bring $5 by Thursday"
}
```

RLS: owner-only read/write. GRANT to `authenticated` + `service_role`.

New storage bucket `golden` (private, signed URLs for viewing).

### 2. Seed the Main Street Theater case

Migration inserts one row with:
- Image uploaded to `golden/main-street-theater.jpg` (re-uploaded from `user-uploads://image.jpg`)
- `expected_items` covering 4 tasks: pizza $5/Thu, performance Fri (date unknown — needs group), label props/costumes (Thu reminder), video link FYI (no action)
- `expected_clarifications`: `[{question:"Which group is your child in?", options:["A (6-7) 3:30","B (8-10) 4:30","SSC (11-14) 5:30"]}, {question:"What's the date of this Friday?"}]`
- `failure_tags`: `['hallucinated_date','missed_multi_task','dropped_context','missed_clarification']`

### 3. Admin UI — `/golden`

Authenticated route. Two screens:

- **List**: cards with thumbnail, title, # expected items, failure tags, last eval result.
- **New / Edit**: upload image, title, notes, JSON editor (Monaco-lite via `<Textarea>` for now) for `expected_items` and `expected_clarifications`, failure tag chips.
- **Run eval** button on each row: calls the current extractor against the stored image, then renders a side-by-side diff (expected vs actual: item count, missing titles, hallucinated date Y/N).

Nav: add a small "Golden" link in the header (only visible to signed-in users — no role gate v1; we can add admin role later).

### 4. Few-shot injection in `visionExtract`

`src/lib/agent/tools.server.ts` → before calling Gemini, fetch up to 2 golden examples from the same user (most recent first; later swap to embedding similarity) and prepend them as user/assistant turns showing input → expected JSON. Existing `EXTRACTOR_SYSTEM` prompt gets a new line: *"A document may contain multiple tasks — return one item per actionable task. If a date is partially specified (e.g. only a weekday), set `due_at: null` and put the literal phrase in `due_at_hint`. Never invent a year."*

Also: make `visionExtract` return `ExtractedItem[]` instead of a single item. Graph (`graph.server.ts`) loops and creates one approval per item. This is the structural change the previous reply called out.

### 5. Eval server function

`runGoldenEval(exampleId)` → re-runs `visionExtract` on the stored image, returns `{ expectedCount, actualCount, missingTitles, hallucinatedDate, extraItems, rawActual }`. Stored on the row as `last_eval` jsonb + `last_eval_at`.

## Out of scope for v1 (call out, don't build)

- Embedding-based example selection (we'll use recency first; trivial swap later).
- Automated regression CI run.
- A clarifying-question node in the agent graph — captured in the golden expectations so we can build it next, against a real target.

## Technical details

- New files:
  - `supabase/migrations/<ts>_golden_examples.sql` — table, RLS, GRANTs, storage bucket, seed insert.
  - `src/lib/golden.functions.ts` — `listGolden`, `upsertGolden`, `deleteGolden`, `runGoldenEval`, `uploadGoldenImage` (all `requireSupabaseAuth`).
  - `src/routes/_authenticated/golden.tsx` — list + new/edit dialog + eval results.
- Edited files:
  - `src/lib/agent/tools.server.ts` — multi-item return + few-shot injection + stricter prompt + new `due_at_hint` / `date_known` / `source_quote` fields on `extractedSchema`.
  - `src/lib/agent/types.ts` — extend `ExtractedItem` with the new optional fields; export `ExtractedItem[]` from extract step.
  - `src/lib/agent/graph.server.ts` — extract returns array; loop produces one approval per item; preserve `parent_run_id` link.
  - `src/components/app-shell.tsx` — add "Golden" link in the header menu.
- Seed image: re-upload `user-uploads://image.jpg` to `golden/main-street-theater.jpg` via `supabase--storage_upload` after the migration runs.

## Verification

1. Migration applies; `golden_examples` has 1 seeded row.
2. `/golden` lists the seeded row with thumbnail.
3. Click **Run eval** → result shows current extractor still collapses to 1 item and hallucinates a 2024 date (proves the gap).
4. Re-capture the same flyer via `/capture` → the new multi-item extractor returns ≥3 items, no fabricated year, and queues 3 approvals.
5. Add a second golden example via the UI; confirm it persists and re-runs eval cleanly.
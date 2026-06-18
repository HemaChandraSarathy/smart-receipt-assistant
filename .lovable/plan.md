# Inbox parent split + Soft-delete + Clear actions

## 1. Inbox split by Mom / Dad

Add a second tab row under Open / Done / Cancelled:

```text
[ All ] [ Mom ] [ Dad ] [ Either ]
```

- `All` keeps the current grouped layout (Mom / Dad / Either sections).
- `Mom` / `Dad` / `Either` filter to that assignee (flat list, no section header).
- Each tab shows a count: `Mom · 4`.
- Filter applies across Open, Done, and Cancelled tabs.
- Remember last-picked parent in `localStorage`.

Client-side only — filters on `item.assignee`.

## 2. Soft delete

Soft delete (not hard) so the user can undo or audit. Add a `deleted_at timestamptz` column to `items`, `approvals`, `agent_runs`, and `notifications`. All existing list queries filter `where deleted_at is null`.

New server fns (all `requireSupabaseAuth`, scoped by `user_id`):

- `softDeleteItem({ itemId })` — sets `deleted_at = now()`; best-effort removes the linked calendar event.
- `restoreItem({ itemId })` — clears `deleted_at`.
- `softDeleteApproval({ approvalId })`
- `softDeleteRun({ runId })` — also soft-deletes its approvals.
- `softDeleteNotification({ id })`
- `listDeletedItems()` — for the Trash view.
- Bulk: `clearCancelledItems()`, `clearReadNotifications()`, `clearFinishedRuns()`, `rejectAllApprovals()` — all soft-delete.
- `emptyTrash()` — hard-deletes rows where `deleted_at < now() - 30 days` (also exposed as a button).

After every soft-delete mutation: toast with **Undo** button that calls the corresponding `restore*` fn.

A scheduled cleanup (pg_cron, daily) hard-deletes rows older than 30 days. Out of scope if cron isn't already wired — the "Empty trash" button covers it for now.

### Where the delete (trash) icon appears

| Where | Action |
| --- | --- |
| Inbox row (Open / Done / Cancelled) | `softDeleteItem` + undo toast |
| Approvals card | `softDeleteApproval` (separate from "Skip") |
| Notifications row | `softDeleteNotification` |
| Golden examples row | `softDeleteGoldenExample` |
| Runs row | `softDeleteRun` |

### New Trash view

Add a `Trash` tab to the Inbox status row → `[ Open ] [ Done ] [ Cancelled ] [ Trash ]`. Lists everything soft-deleted in the last 30 days with **Restore** and **Delete forever** buttons, plus a header **Empty trash** button.

## 3. Clear-all buttons — recommendations

Spots that genuinely benefit from a bulk Clear:

1. **Inbox › Cancelled** — "Clear all cancelled" (soft-delete every cancelled item).
2. **Inbox › Trash** — "Empty trash" (hard-delete everything in trash now).
3. **Notifications header** — "Mark all read" + "Clear read".
4. **Approvals page** — "Skip all" (rejects every pending approval).
5. **Runs page** — "Clear finished" (soft-delete completed/failed runs).
6. **Inbox filter row** — small "Clear filters" link when category ≠ All or parent ≠ All.
7. **Golden examples** — "Clear last eval" per row (resets `last_eval`/`last_eval_at`).

Skip Clear-all on Done/Wins — those are reward surfaces.

## Technical notes

- One migration: add `deleted_at timestamptz` (nullable, indexed) to `items`, `approvals`, `agent_runs`, `notifications`, `golden_examples`. No data backfill needed.
- Update every existing `select` in `agent.functions.ts` / `golden.functions.ts` to add `.is('deleted_at', null)` — list this as a checklist in the implementation, easy to miss.
- New `<DeleteButton>` component: trash icon, confirm dialog, calls the relevant `softDelete*` fn, fires undo toast.
- `useUndoToast(restoreFn, label)` helper to keep call-sites tiny.
- Approvals "Skip" stays as today (rejects the agent step); the new trash icon is a separate destructive action that removes the approval row.
- Inbox parent tabs: lift a `parent` state alongside `status` and `cat`; pass into Open/Done/Cancelled/Trash views.

## Out of scope

- Auto-purge cron job (manual "Empty trash" button instead).
- Multi-select bulk delete inside Inbox lists.
- Restoring a deleted run's calendar event (soft-delete only clears the row, not the calendar artifact).

# Navigation + Approve refresh

## 1. Bottom bar: 4 tabs + center ＋ FAB

In `src/components/app-shell.tsx`, restructure the bottom bar:

```text
[ Inbox ]  [ Approve ]  ( ＋ )  [ Ask ]  [ Runs ]
                          ↑
                  Capture (raised circular FAB)
```

- Remove Calendar and Wins from `tabs[]`.
- Render 4 flat tabs with a center slot occupied by a raised circular button: ~56px, primary color, white `Plus` icon, soft shadow, sits ~12px above the bar baseline, links to `/capture`.
- Active state for the FAB when route === `/capture` (slightly larger ring / filled).
- Keep existing icons/labels for the 4 flat tabs.

## 2. Calendar → top-right header icon

In `PageShell` header (same file), add a `CalendarDays` icon button (Link to `/calendar`) immediately left of `NotificationBell`. No badge. `/calendar` route stays as-is.

## 3. Wins folded into Inbox as a "Done" tab

In `src/routes/_authenticated/inbox.tsx`:

- Add a status switcher row above the existing category chips:
  `[ Open ] [ Done ] [ Cancelled ]` (segmented control style).
- **Open**: current behavior (existing filters and cards).
- **Done**: fetches via existing `listWins` server fn; renders week groupings + a compact stat strip (this-week count, on-time %, total paid) reusing the visuals from `/wins`.
- **Cancelled**: items with `status = 'cancelled'`, read-only cards.
- Category chips continue to filter within the active status tab.
- Delete `src/routes/_authenticated/wins.tsx` and remove the Wins entry from anywhere it's still referenced (nav, avatar menu).

## 4. Approve: editable fields + notes textarea

In `src/routes/_authenticated/approvals.tsx`:

- Replace the "Edit" toggle with always-visible field editors on `save_item` and `create_calendar_event` cards:
  - Title (input)
  - Amount (input, where relevant)
  - Due date / event time (date+time input)
  - Assignee (input)
- Add a **"Notes for the calendar event"** `<Textarea>` below the fields. Its value flows into `patch.description` (and `patch.note` for save_item).
- Buttons: single primary **"Approve & save to calendar"** (sends `decision.action: "edit"` with `patch`), plus **"Skip"**.
- Server: `resumeRun` already merges `decision.patch`. Ensure `graph.server.ts` / `tools.server.ts` pass `description` into the Google Calendar event body so the note actually lands on the event.

## 5. Feedback row (your question)

The Done / Reschedule / Cancel buttons already render as `ItemActions` on every Inbox card — that is the feedback surface we discussed. After this change:
- Visible on **Open** cards (full actions).
- Hidden on **Done** cards (already complete).
- Shown read-only on **Cancelled** cards (no actions, just status).

If you also want the same Done/Reschedule/Cancel row on Approvals cards, say so and I'll add it.

## Files touched

- `src/components/app-shell.tsx` — 4 tabs + center FAB, Calendar header icon, remove Wins.
- `src/routes/_authenticated/inbox.tsx` — Open/Done/Cancelled status switcher, fold Wins view in.
- `src/routes/_authenticated/approvals.tsx` — always-editable fields + Notes textarea, single approve button.
- `src/server/graph.server.ts` and/or `src/lib/tools.server.ts` — pass note into Calendar event description.
- Delete `src/routes/_authenticated/wins.tsx`.

## Out of scope

- No page redesigns beyond the above.
- No badge counts on the new Calendar header icon.
- No DB schema changes (`status = 'cancelled'` and wins data already exist).
- `/calendar`, `/runs` routes keep working unchanged; only their entry points move.

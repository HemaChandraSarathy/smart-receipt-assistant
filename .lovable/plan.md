## Goal

Give every item a lifecycle you can drive — **done / reschedule / cancel** — with the Google Calendar event kept in sync, plus a "Wins" view that celebrates everything you've completed.

## What you'll see

On every item card (Inbox, Calendar, Approvals) you get a status pill and three actions:

```text
┌─ Pay Main Street $5 ──────────────── [DUE TODAY] ┐
│ bill · dad · due Jun 18                          │
│                                                  │
│  [✓ Mark done]   [↻ Reschedule]   [✕ Cancel]     │
└──────────────────────────────────────────────────┘
```

- **Mark done** → status flips to `done`, item leaves Inbox/Calendar, Google Calendar event title gets a `✓` prefix and is marked completed (or moved to a "Done" calendar entry on the day you completed it), follow-up nudges cancelled, a toast fires ("Nice — $5 to Main Street, done 🎉") and the item appears in **Wins**.
- **Reschedule** → date picker (defaults to tomorrow), updates `due_at`/`expires_at`/`rsvp_by` on the item, patches the Google Calendar event's start/end, reschedules the follow-up nudge for 24h before the new date. The card stays in place and shows "Rescheduled from Jun 18 → Jun 19".
- **Cancel** → status flips to `cancelled`, the Google Calendar event is **deleted**, follow-ups cancelled, item disappears from Inbox/Calendar (visible only in a "Cancelled" filter).

## New `/wins` tab

A celebration feed of everything you've marked done, grouped by week:

```text
This week — 4 wins ✨
  ✓ Paid Main Street $5         Jun 18 · dad
  ✓ RSVP'd to Sam's birthday    Jun 17 · mom
  ✓ Booked HVAC tune-up         Jun 16 · dad
  ✓ Renewed library books       Jun 15 · mom

Last week — 7 wins
  …

This month: 11 done · $340 paid on time · 0 missed
```

Small streak counter at the top ("3 weeks in a row with zero missed deadlines"). No moralising on misses — only positive framing.

## Reminders that keep you honest

Already in the schema (`followups` table, `next_nudge_at`). Today nothing actually fires them — this plan adds the worker:

- A `pg_cron` job runs every 15 minutes hitting a public route `/api/public/hooks/run-followups`.
- The route picks up due rows where `state='scheduled'`, marks them `running`, and inserts an in-app notification row.
- A bell icon in the app shell shows unread nudges with a count badge; clicking jumps to the item with the action buttons highlighted.
- Nudge cadence per item: T-24h, T-2h, and T+0 (the deadline itself). After T+0, one daily nudge until you mark done / reschedule / cancel — so it actually keeps you honest.

## Technical details

### Schema migration

Add to `items`:
- `status text not null default 'open' check (status in ('open','done','cancelled'))`
- `completed_at timestamptz`
- `cancelled_at timestamptz`
- `calendar_event_id text` (currently only stored in `agent_events` — promote to a first-class column so updates/deletes are cheap)
- `reschedule_count int not null default 0`
- `original_due_at timestamptz` (set on first reschedule so Wins can show "on time vs late")

Add to `followups`:
- extend `state` check to include `acknowledged`, `dismissed`

New `notifications` table (id, user_id, item_id, kind, title, body, read_at, created_at) with RLS scoped to `auth.uid()`, indexed on `(user_id, read_at, created_at desc)`. GRANTs to `authenticated` + `service_role`.

### Server functions (`src/lib/agent.functions.ts`)

All `requireSupabaseAuth`, all Zod-validated:
- `markItemDone({ itemId })` — updates item, patches Google Calendar event (✓ prefix + `status:'cancelled'` so it stops alerting, or move to a done sub-calendar), cancels followups, inserts win notification.
- `rescheduleItem({ itemId, newDate })` — updates due/expires/rsvp on item, calls `calendar.events.patch` to move event, reschedules followup, increments `reschedule_count`, sets `original_due_at` if null.
- `cancelItem({ itemId, reason? })` — sets status, calls `calendar.events.delete`, cancels followups.
- `listWins({ range?: 'week'|'month'|'all' })` — items where `status='done'`, grouped/ordered for the Wins page.
- `listNotifications()` / `markNotificationRead({ id })`.

Google Calendar gateway calls use the existing `calendarCreateEvent` pattern in `src/lib/agent/tools.server.ts` — add `calendarPatchEvent(eventId, patch)` and `calendarDeleteEvent(eventId)` siblings.

### Follow-up worker

- New file `src/routes/api/public/hooks/run-followups.ts` — public route, validates `apikey` header against `SUPABASE_PUBLISHABLE_KEY`, loads `supabaseAdmin` inside the handler, claims due followups (`update … returning`), inserts notifications, computes next nudge based on cadence above.
- `pg_cron` job scheduled via the insert tool (not migration) to POST every 15 minutes.

### UI changes

- New file `src/components/item-actions.tsx` — the three-button row with confirm dialog for cancel and a `Popover` + `Calendar` for reschedule. Used by Inbox, Calendar, Approvals cards.
- Edit `src/routes/_authenticated/inbox.tsx`, `calendar.tsx` — render actions row; hide `done`/`cancelled` by default, add a filter.
- New file `src/routes/_authenticated/wins.tsx` — the celebration feed described above.
- Edit `src/components/app-shell.tsx` — add "Wins" tab (Trophy icon) and a bell icon with unread count (polls `listNotifications` every 30s via React Query).
- Sonner toast on each action ("Done 🎉", "Moved to Jun 19", "Cancelled — calendar cleared").

## What I'm not building unless you ask

- Push / email / SMS nudges (in-app bell only for now — fastest to ship, no extra connectors).
- "Snooze 1h" micro-action — reschedule covers it.
- Sharing wins with the other parent — single-user celebration only.
- Editing the calendar event title/description from the app (only date and status are patched).

## Files touched

- migration: add columns to `items`, `followups`; new `notifications` table
- new `src/routes/api/public/hooks/run-followups.ts`
- new `src/routes/_authenticated/wins.tsx`
- new `src/components/item-actions.tsx`
- edited `src/lib/agent.functions.ts` (5 new server fns)
- edited `src/lib/agent/tools.server.ts` (`calendarPatchEvent`, `calendarDeleteEvent`)
- edited `src/routes/_authenticated/inbox.tsx`, `calendar.tsx`, `approvals.tsx`
- edited `src/components/app-shell.tsx` (Wins tab + notification bell)
- data: `pg_cron` schedule via insert tool

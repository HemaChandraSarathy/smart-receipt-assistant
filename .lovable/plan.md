## What's going on

Two separate things got tangled:

1. **App login (who you are in the app)** — Google is silently re-using your personal Gmail session from the browser, so even though you intended to pick `sarmahousehold@gmail.com`, Google never asked.
2. **Gmail inbox the agent reads** — this is the workspace Gmail *connector*, completely separate from app login. It currently points at your personal Gmail and needs to be re-pointed at the project Gmail.

Yes — the system is a true agentic workflow (graph-based routing, tool calls, persisted state across stateless Workers, error capture, and human-in-the-loop approval gates before any write/calendar/email action).

## Plan

### 1. Fix the app login so it always asks which Google account to use
Update the Google sign-in call in `src/routes/auth.tsx` to pass `prompt: "select_account"` via `extraParams`. This forces Google's account chooser every time instead of auto-signing you in with whichever Google account your browser remembers.

Then, so you can actually switch:
- Sign out of the app (if signed in as the personal account).
- On the auth page, click "Continue with Google" → Google will now show the picker → choose `sarmahousehold@gmail.com`.

If the personal account is still the only one Google offers, it's because the browser only has that one Google session. Add the project account to Chrome (or sign into gmail.com with it once in the same browser), then retry — the picker will list both.

### 2. Re-point the Gmail connector at the project Gmail
The Gmail connector is workspace-scoped, not per-user, so reconnecting it changes which inbox the agent scans for everyone. I'll trigger a reconnect flow for the Gmail connection so you can authorize `sarmahousehold@gmail.com` instead of your personal account. Same thing for Google Calendar if you want events created on the project calendar.

### 3. (No code changes needed for the agent itself)
The agentic workflow is already in place — LangGraph state machine, tool nodes (Gmail, Vision, Calendar, embeddings), persisted `agent_runs` state for resume-across-Workers, error tracking, and `approvals` gates with `resumeRun`. Nothing to change there.

## Technical details

- `src/routes/auth.tsx` `onGoogle()` → add `extraParams: { prompt: "select_account" }` to the `lovable.auth.signInWithOAuth("google", ...)` call. One-line change.
- Reconnect Gmail and Google Calendar connectors via the connector reconnect flow so the new account's tokens replace the existing ones.
- No DB, RLS, or agent code changes.

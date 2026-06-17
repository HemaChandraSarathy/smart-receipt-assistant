## Add account badge + Sign Out to the app header

The app shell (`src/components/app-shell.tsx`) wraps all `_authenticated/*` routes. Add a small header strip with:

- **Avatar** (user's Google profile picture from `user.user_metadata.avatar_url`, fallback initials)
- **Email** (`user.email`) — so you can always confirm which Google account is active
- **Sign Out button** — calls `supabase.auth.signOut()` then navigates to `/auth`

### Behavior
- Loads current user via `supabase.auth.getUser()` on mount + listens to `onAuthStateChange` so the header updates immediately after sign-in/out.
- Sign-out follows the hygiene order: cancel queries → clear cache → `signOut()` → `navigate("/auth", { replace: true })`.
- After signing out, clicking "Continue with Google" again will show the Google account picker (because of the `prompt: "select_account"` change already shipped), letting you visibly confirm or switch accounts.

### Files touched
- `src/components/app-shell.tsx` — add header row with avatar/email/sign-out. No other files change.

### Not changing
- Auth route, agent code, connectors, DB. Already correctly pointed at `sarmahousehold@gmail.com`.

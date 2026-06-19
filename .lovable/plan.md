# Add README.md

Create a `README.md` at the project root describing Unburden — the mental-inbox app — so it renders well on GitHub.

## Sections

1. **Title + tagline** — "Unburden — your mental inbox."
2. **What it does** — short paragraph: capture any bill, promo, invite, repair, or return; the agent extracts, assigns to Mom/Dad/Either, schedules, and follows up.
3. **Features** — bullet list:
   - Inbox with Open / Done / Cancelled and per-parent filters
   - Calendar view with Google Calendar sync (create + delete)
   - Ask: natural-language Q&A over your items, with Gmail fallback scan for promos
   - Approvals queue for agent actions
   - Runs + LangSmith trace links
   - Golden examples for eval
   - Notifications + follow-ups
4. **Tech stack** — TanStack Start (React 19, Vite 7), Tailwind v4, shadcn/ui, Lovable Cloud (Supabase: Postgres + Auth + Storage), Lovable AI Gateway (Gemini), LangGraph agent, Google Calendar + Gmail APIs.
5. **Getting started** — `bun install`, `bun dev`, note that backend env vars (`VITE_SUPABASE_*`) are auto-managed by Lovable Cloud.
6. **Project structure** — short tree of `src/routes`, `src/lib/agent`, `src/components`, `supabase/migrations`.
7. **Editing** — two options: edit on Lovable (link to project URL) or clone the GitHub repo and push (auto-syncs back).
8. **Deploy** — via Lovable Publish.
9. **License** — MIT placeholder (user can change).

## Notes

- No code changes outside the new `README.md`.
- Use plain GitHub-flavored markdown; no emojis.
- Reference the Lovable preview URL from project URLs.

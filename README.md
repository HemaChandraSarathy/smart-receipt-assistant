# Unburden

Your mental inbox — offload it, plan it, execute it.

Unburden captures every bill, promo, invite, repair, and return that's living rent-free in your head. An LLM agent extracts the details, assigns it to Mom / Dad / Either, schedules it on your calendar, and follows up so nothing slips.

> Live preview: https://id-preview--ca5f9919-909e-4e55-aa3c-4691bc28ef72.lovable.app

## Features

- **Inbox** — Open / Done / Cancelled tabs with per-parent filters (Mom / Dad / Either) and inline edit.
- **Calendar** — month view of upcoming items, two-way Google Calendar sync (create + delete).
- **Ask** — natural-language Q&A over your items. Falls back to a Gmail scan for promo / coupon / gift-card questions when the local index has no match. No hallucinated answers.
- **Approvals** — a queue for any agent action that needs human sign-off before it runs.
- **Runs** — every agent run is recorded with a LangSmith trace link.
- **Golden examples** — curated input/output pairs used to evaluate the agent over time.
- **Notifications & follow-ups** — quiet nudges when something is due.

## Tech stack

- [TanStack Start](https://tanstack.com/start) (React 19, Vite 7) — full-stack framework with file-based routing and typed server functions.
- Tailwind CSS v4 + [shadcn/ui](https://ui.shadcn.com).
- [Lovable Cloud](https://lovable.dev) (Postgres, Auth, Storage, Edge functions).
- [Lovable AI Gateway](https://lovable.dev) — Gemini 2.5 Flash for extraction and answering.
- [LangGraph](https://langchain-ai.github.io/langgraphjs/) — agent graph with checkpointing and approvals.
- Google Calendar + Gmail APIs via OAuth.

## Getting started

```bash
bun install
bun dev
```

Then open http://localhost:8080.

Backend environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`) are managed by Lovable Cloud and live in `.env`. Don't edit them by hand.

To connect Gmail / Google Calendar, sign in inside the app and grant access from the Capture / Calendar screens.

## Project structure

```text
src/
  routes/                  # file-based routes (TanStack Start)
    _authenticated/        # gated app surface: inbox, calendar, ask, approvals, runs, golden, capture
    api/public/            # webhooks + cron endpoints (no auth)
  lib/
    agent/                 # LangGraph nodes, tools, runtime (server-only)
    agent.functions.ts     # client-callable server functions
    golden.functions.ts
  components/              # shared UI + shadcn primitives
  integrations/supabase/   # auto-generated client + auth middleware (do not edit)
supabase/
  migrations/              # schema + RLS policies
```

## Editing

You have two equivalent ways to change the code — they stay in sync:

1. **On Lovable** — open the project and prompt. Changes commit to GitHub automatically.
2. **Locally / on GitHub** — clone the repo, push to your default branch, and Lovable picks it up.

## Deploying

Open the project on Lovable and click **Publish**. Custom domains are configured under Project → Settings → Domains.

## License

MIT. Swap in your own license file if you prefer something else.

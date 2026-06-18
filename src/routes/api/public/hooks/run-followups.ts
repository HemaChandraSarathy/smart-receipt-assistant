import { createFileRoute } from "@tanstack/react-router";

// Cron-triggered: scans due followups, inserts in-app notifications, and
// reschedules the next nudge per the cadence (T-24h → T-2h → T+0 → daily).
export const Route = createFileRoute("/api/public/hooks/run-followups")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || apiKey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = new Date();
        const nowISO = now.toISOString();

        const { data: due, error } = await supabaseAdmin
          .from("followups")
          .select("id, user_id, item_id, attempts")
          .eq("state", "scheduled")
          .lte("next_nudge_at", nowISO)
          .limit(50);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        let fired = 0;
        for (const f of due ?? []) {
          // Skip if item already done/cancelled
          const { data: item } = await supabaseAdmin
            .from("items")
            .select("id, title, status, due_at, expires_at, rsvp_by")
            .eq("id", f.item_id)
            .maybeSingle();
          if (!item) continue;
          if (item.status !== "open") {
            await supabaseAdmin
              .from("followups")
              .update({ state: "dismissed" })
              .eq("id", f.id);
            continue;
          }

          const deadline = item.due_at ?? item.expires_at ?? item.rsvp_by;
          const deadlineMs = deadline ? new Date(deadline).getTime() : null;
          const msToDeadline = deadlineMs ? deadlineMs - now.getTime() : null;

          let title = "Reminder";
          let body = item.title;
          if (msToDeadline == null) {
            title = "Friendly nudge";
          } else if (msToDeadline > 12 * 60 * 60_000) {
            title = "Coming up tomorrow";
            body = `${item.title} — due ${new Date(deadlineMs!).toLocaleDateString()}`;
          } else if (msToDeadline > 0) {
            title = "Due today";
            body = item.title;
          } else {
            title = "Overdue — still on your list";
            body = item.title;
          }

          await supabaseAdmin.from("notifications").insert({
            user_id: f.user_id,
            item_id: f.item_id,
            kind: "nudge",
            title,
            body,
          });

          // Compute next nudge
          let nextMs: number;
          if (msToDeadline == null) {
            nextMs = now.getTime() + 24 * 60 * 60_000;
          } else if (msToDeadline > 2 * 60 * 60_000) {
            nextMs = deadlineMs! - 2 * 60 * 60_000;
          } else if (msToDeadline > 0) {
            nextMs = deadlineMs!;
          } else {
            nextMs = now.getTime() + 24 * 60 * 60_000;
          }

          await supabaseAdmin
            .from("followups")
            .update({
              next_nudge_at: new Date(nextMs).toISOString(),
              last_run_at: nowISO,
              attempts: (f.attempts ?? 0) + 1,
              state: "scheduled",
            })
            .eq("id", f.id);

          fired += 1;
        }

        return Response.json({ ok: true, fired, scanned: due?.length ?? 0 });
      },
    },
  },
});

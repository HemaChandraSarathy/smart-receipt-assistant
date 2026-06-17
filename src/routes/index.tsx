import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Inbox — Your household paper trail" },
      { name: "description", content: "Snap, scan, and let agents sort every receipt, promo, coupon, bill, and RSVP." },
      { property: "og:title", content: "Inbox" },
      { property: "og:description", content: "Your household paper trail, handled by agents." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      navigate({ to: data.user ? "/inbox" : "/auth" });
    });
  }, [navigate]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-muted-foreground">Loading…</p>
    </div>
  );
}

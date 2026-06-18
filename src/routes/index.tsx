import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Unburden — Your mental inbox" },
      { name: "description", content: "Offload, plan, and execute every bill, promo, invite, repair, and return." },
      { property: "og:title", content: "Unburden" },
      { property: "og:description", content: "Your mental inbox — offload it, plan it, execute it." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    async function routeFromSession() {
      const { data: sessionData } = await supabase.auth.getSession();
      if (cancelled) return;
      if (sessionData.session) {
        navigate({ to: "/inbox", replace: true });
        return;
      }

      const { data } = await supabase.auth.getUser();
      if (!cancelled) navigate({ to: data.user ? "/inbox" : "/auth", replace: true });
    }
    void routeFromSession();
    return () => {
      cancelled = true;
    };
  }, [navigate]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-muted-foreground">Loading…</p>
    </div>
  );
}

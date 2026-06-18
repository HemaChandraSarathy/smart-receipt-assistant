import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Prefer the cached session — it's synchronous-ish and doesn't hit the network,
    // so navigating between authenticated tabs doesn't trigger a fetch that can
    // briefly fail with "TypeError: Load failed" and flash the root error page.
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user) return { user: sessionData.session.user };
    } catch {
      // fall through to getUser()
    }

    try {
      const { data, error } = await supabase.auth.getUser();
      if (!error && data.user) return { user: data.user };
    } catch {
      // Transient network failure — don't throw it up to the route error
      // boundary; just send the user to /auth where they can retry.
    }

    throw redirect({ to: "/auth" });
  },
  component: () => <Outlet />,
});

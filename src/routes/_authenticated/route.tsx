import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Use getSession() only — it reads from localStorage and auto-refreshes if
    // needed, so it doesn't hit the network on every tab switch. getUser()
    // always does a network round-trip; when it transiently fails with
    // "TypeError: Load failed" the throw bubbles to the root errorComponent
    // and flashes "This page didn't load" before the new page renders.
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) return { user: data.session.user };
    } catch {
      // Treat network/cache hiccups as "not signed in" — never throw here.
    }
    throw redirect({ to: "/auth" });
  },
  component: () => <Outlet />,
  // Belt-and-suspenders: if anything in this subtree throws during navigation
  // (e.g. a transient fetch), keep the error contained instead of letting it
  // hit the root boundary.
  errorComponent: ({ reset }) => {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <button
          onClick={reset}
          className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
        >
          Retry
        </button>
      </div>
    );
  },
});

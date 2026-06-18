import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Camera, Inbox as InboxIcon, CheckCircle2, MessageCircle, Activity, LogOut, CalendarDays } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const tabs = [
  { to: "/inbox", label: "Inbox", icon: InboxIcon },
  { to: "/capture", label: "Capture", icon: Camera },
  { to: "/approvals", label: "Approve", icon: CheckCircle2 },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/ask", label: "Ask", icon: MessageCircle },
  { to: "/runs", label: "Runs", icon: Activity },
] as const;

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70 pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-md justify-between px-4 py-2">
        {tabs.map(({ to, label, icon: Icon }) => {
          const active = pathname.startsWith(to);
          return (
            <li key={to} className="flex-1">
              <Link
                to={to}
                className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition-colors ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function AccountBadge() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<{ email: string | null; avatar: string | null } | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      const u = data.user;
      setUser(
        u
          ? { email: u.email ?? null, avatar: (u.user_metadata?.avatar_url as string) ?? null }
          : null,
      );
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const u = session?.user;
      setUser(
        u
          ? { email: u.email ?? null, avatar: (u.user_metadata?.avatar_url as string) ?? null }
          : null,
      );
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const initials = (user?.email ?? "?").slice(0, 1).toUpperCase();

  const onSignOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  if (!user) return null;

  return (
    <div className="flex items-center gap-2">
      <div className="hidden sm:flex flex-col items-end leading-tight">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Signed in</span>
        <span className="text-xs text-foreground max-w-[180px] truncate">{user.email}</span>
      </div>
      {user.avatar ? (
        <img
          src={user.avatar}
          alt={user.email ?? "account"}
          className="h-7 w-7 rounded-full border border-border"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="h-7 w-7 rounded-full bg-primary/10 text-primary text-xs font-medium flex items-center justify-center border border-border">
          {initials}
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onSignOut}
        title={`Sign out (${user.email ?? ""})`}
        aria-label="Sign out"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function PageShell({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-3">
          <h1 className="font-serif text-2xl text-foreground truncate">{title}</h1>
          <div className="flex items-center gap-2">
            {action}
            <AccountBadge />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 py-4">{children}</main>
      <BottomNav />
    </div>
  );
}

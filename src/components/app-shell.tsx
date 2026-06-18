import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Inbox as InboxIcon, CheckCircle2, MessageCircle, Activity, LogOut, CalendarDays, Plus } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notification-bell";

const leftTabs = [
  { to: "/inbox", label: "Inbox", icon: InboxIcon },
  { to: "/approvals", label: "Approve", icon: CheckCircle2 },
] as const;

const rightTabs = [
  { to: "/ask", label: "Ask", icon: MessageCircle },
  { to: "/runs", label: "Runs", icon: Activity },
] as const;

function TabLink({ to, label, Icon, active }: { to: string; label: string; Icon: typeof InboxIcon; active: boolean }) {
  return (
    <Link
      to={to}
      className={`flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition-colors ${
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-5 w-5" />
      {label}
    </Link>
  );
}

export function BottomNav() {
  const { pathname } = useLocation();
  const captureActive = pathname.startsWith("/capture");
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto max-w-md px-4 py-2 relative">
        <ul className="grid grid-cols-5 items-center">
          {leftTabs.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <TabLink to={to} label={label} Icon={Icon} active={pathname.startsWith(to)} />
            </li>
          ))}
          <li className="flex justify-center">
            {/* spacer for FAB */}
            <span className="block h-12 w-12" aria-hidden />
          </li>
          {rightTabs.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <TabLink to={to} label={label} Icon={Icon} active={pathname.startsWith(to)} />
            </li>
          ))}
        </ul>
        <Link
          to="/capture"
          aria-label="Capture"
          className={`absolute left-1/2 -translate-x-1/2 -top-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-4 ring-background transition-transform active:scale-95 ${
            captureActive ? "scale-105" : ""
          }`}
        >
          <Plus className="h-7 w-7" strokeWidth={2.5} />
        </Link>
      </div>
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
          <div className="flex items-center gap-1">
            {action}
            <Button asChild variant="ghost" size="icon" aria-label="Calendar">
              <Link to="/calendar"><CalendarDays className="h-4 w-4" /></Link>
            </Button>
            <NotificationBell />
            <AccountBadge />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 py-4">{children}</main>
      <BottomNav />
    </div>
  );
}

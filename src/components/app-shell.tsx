import { Link, useLocation } from "@tanstack/react-router";
import { Camera, Inbox as InboxIcon, CheckCircle2, MessageCircle, Activity } from "lucide-react";

const tabs = [
  { to: "/inbox", label: "Inbox", icon: InboxIcon },
  { to: "/capture", label: "Capture", icon: Camera },
  { to: "/approvals", label: "Approve", icon: CheckCircle2 },
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

export function PageShell({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center justify-between px-4 py-4">
          <h1 className="font-serif text-2xl text-foreground">{title}</h1>
          {action}
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 py-4">{children}</main>
      <BottomNav />
    </div>
  );
}

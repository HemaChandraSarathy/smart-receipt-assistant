import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, startOfWeek, isThisWeek, isThisMonth } from "date-fns";
import { Trophy, Sparkles } from "lucide-react";

import { PageShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { listWins } from "@/lib/agent.functions";
import type { Assignee, ItemCategory } from "@/lib/agent/types";

export const Route = createFileRoute("/_authenticated/wins")({
  head: () => ({ meta: [{ title: "Wins — your household paper trail" }] }),
  component: WinsPage,
});

type Win = {
  id: string;
  title: string;
  category: ItemCategory;
  assignee: Assignee;
  merchant: string | null;
  amount: number | null;
  currency: string | null;
  due_at: string | null;
  expires_at: string | null;
  rsvp_by: string | null;
  original_due_at: string | null;
  completed_at: string | null;
  reschedule_count: number;
};

function WinsPage() {
  const fn = useServerFn(listWins);
  const { data, isLoading } = useQuery({
    queryKey: ["wins"],
    queryFn: async () => (await fn()) as unknown as Win[],
    refetchInterval: 30_000,
  });

  const wins = data ?? [];
  const thisWeek = wins.filter((w) => w.completed_at && isThisWeek(new Date(w.completed_at), { weekStartsOn: 1 }));
  const thisMonth = wins.filter((w) => w.completed_at && isThisMonth(new Date(w.completed_at)));
  const totalPaid = thisMonth
    .filter((w) => w.category === "bill" && w.amount != null)
    .reduce((sum, w) => sum + Number(w.amount ?? 0), 0);
  const onTime = thisMonth.filter((w) => {
    if (!w.completed_at) return false;
    const deadline = w.original_due_at ?? w.due_at ?? w.expires_at ?? w.rsvp_by;
    if (!deadline) return true;
    return new Date(w.completed_at).getTime() <= new Date(deadline).getTime() + 24 * 60 * 60_000;
  }).length;

  // group all wins by ISO week
  const byWeek = new Map<string, Win[]>();
  for (const w of wins) {
    if (!w.completed_at) continue;
    const key = format(startOfWeek(new Date(w.completed_at), { weekStartsOn: 1 }), "yyyy-MM-dd");
    const arr = byWeek.get(key) ?? [];
    arr.push(w);
    byWeek.set(key, arr);
  }

  return (
    <PageShell title="Wins">
      <Card className="p-4 mb-4 bg-primary/5 border-primary/20">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="font-serif text-lg">This week — {thisWeek.length} {thisWeek.length === 1 ? "win" : "wins"}</h2>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center mt-3">
          <Stat label="Done" value={String(thisMonth.length)} sub="this month" />
          <Stat label="On time" value={`${onTime}/${thisMonth.length || 0}`} sub="this month" />
          <Stat label="Paid" value={totalPaid > 0 ? `$${totalPaid.toFixed(0)}` : "—"} sub="bills this month" />
        </div>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && wins.length === 0 && (
        <Card className="p-6 text-center">
          <Trophy className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="font-serif text-lg">No wins yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Mark something done in Inbox and it'll show up here.
          </p>
        </Card>
      )}

      {Array.from(byWeek.entries()).map(([weekKey, list]) => (
        <WeekGroup key={weekKey} weekKey={weekKey} list={list} />
      ))}
    </PageShell>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-serif text-xl mt-0.5">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}

function WeekGroup({ weekKey, list }: { weekKey: string; list: Win[] }) {
  const start = new Date(weekKey);
  const isCurrent = isThisWeek(start, { weekStartsOn: 1 });
  const label = isCurrent ? "This week" : `Week of ${format(start, "MMM d")}`;
  return (
    <section className="mb-5">
      <div className="flex items-center gap-2 mb-2 px-1">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">{label}</h2>
        <span className="text-xs text-muted-foreground">· {list.length}</span>
      </div>
      <div className="space-y-2">
        {list.map((w) => (
          <Card key={w.id} className="p-3">
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-2 min-w-0 flex-1">
                <span className="text-emerald-600">✓</span>
                <h3 className="font-serif text-base leading-tight truncate">{w.title}</h3>
              </div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                {w.assignee}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground pl-5">
              {w.merchant && <span>{w.merchant}</span>}
              {w.amount != null && <span>${Number(w.amount).toFixed(2)}</span>}
              {w.completed_at && <span>{format(new Date(w.completed_at), "EEE MMM d")}</span>}
              {w.reschedule_count > 0 && (
                <span className="text-amber-600">↻ {w.reschedule_count}</span>
              )}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

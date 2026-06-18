import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, startOfWeek, isThisWeek, isThisMonth } from "date-fns";
import { useState } from "react";
import { Sparkles, Trophy } from "lucide-react";

import { PageShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ItemActions } from "@/components/item-actions";
import { listItems, listWins } from "@/lib/agent.functions";
import type { Assignee, ItemCategory } from "@/lib/agent/types";

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({ meta: [{ title: "Inbox — Your household paper trail" }] }),
  component: InboxPage,
});

type Item = {
  id: string;
  category: ItemCategory;
  topic: string | null;
  assignee: Assignee;
  title: string;
  merchant: string | null;
  amount: number | null;
  currency: string | null;
  due_at: string | null;
  expires_at: string | null;
  rsvp_by: string | null;
  status?: string;
  created_at: string;
};

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

type Status = "open" | "done" | "cancelled";

const CATS: Array<{ key: "all" | ItemCategory; label: string }> = [
  { key: "all", label: "All" },
  { key: "bill", label: "Bills" },
  { key: "promo", label: "Promos" },
  { key: "coupon", label: "Coupons" },
  { key: "invite", label: "Invites" },
  { key: "receipt", label: "Receipts" },
];

function InboxPage() {
  const list = useServerFn(listItems);
  const { data, isLoading } = useQuery({
    queryKey: ["items"],
    queryFn: async () => (await list()) as unknown as Item[],
    refetchInterval: 10_000,
  });
  const [status, setStatus] = useState<Status>("open");
  const [cat, setCat] = useState<"all" | ItemCategory>("all");

  return (
    <PageShell title="Inbox">
      <Tabs value={status} onValueChange={(v) => setStatus(v as Status)} className="mb-3">
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="open" className="text-xs">Open</TabsTrigger>
          <TabsTrigger value="done" className="text-xs">Done</TabsTrigger>
          <TabsTrigger value="cancelled" className="text-xs">Cancelled</TabsTrigger>
        </TabsList>
      </Tabs>

      <Tabs value={cat} onValueChange={(v) => setCat(v as "all" | ItemCategory)} className="mb-4">
        <TabsList className="w-full justify-start overflow-x-auto">
          {CATS.map((c) => (
            <TabsTrigger key={c.key} value={c.key} className="text-xs">{c.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {status === "open" && (
        <OpenView data={data} isLoading={isLoading} cat={cat} />
      )}
      {status === "done" && <DoneView cat={cat} />}
      {status === "cancelled" && (
        <CancelledView data={data} isLoading={isLoading} cat={cat} />
      )}
    </PageShell>
  );
}

function OpenView({ data, isLoading, cat }: { data: Item[] | undefined; isLoading: boolean; cat: "all" | ItemCategory }) {
  const open = (data ?? []).filter((i) => (i.status ?? "open") === "open");
  const filtered = open.filter((i) => cat === "all" || i.category === cat);
  const mom = filtered.filter((i) => i.assignee === "mom");
  const dad = filtered.filter((i) => i.assignee === "dad");
  const either = filtered.filter((i) => i.assignee === "either");
  return (
    <>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && filtered.length === 0 && (
        <Card className="p-6 text-center">
          <p className="font-serif text-lg">Nothing here yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Tap the ＋ button to add a receipt, bill, or coupon.
          </p>
        </Card>
      )}
      <Group label="Mom" items={mom} accent="mom" />
      <Group label="Dad" items={dad} accent="dad" />
      <Group label="Either" items={either} accent="either" />
    </>
  );
}

function CancelledView({ data, isLoading, cat }: { data: Item[] | undefined; isLoading: boolean; cat: "all" | ItemCategory }) {
  const cancelled = (data ?? []).filter((i) => i.status === "cancelled");
  const filtered = cancelled.filter((i) => cat === "all" || i.category === cat);
  return (
    <>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && filtered.length === 0 && (
        <Card className="p-6 text-center">
          <p className="font-serif text-lg">No cancelled items</p>
        </Card>
      )}
      <div className="space-y-2">
        {filtered.map((it) => (
          <Card key={it.id} className="p-4 opacity-70">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-serif text-base leading-tight flex-1 line-through">{it.title}</h3>
              <CategoryChip cat={it.category} />
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              {it.merchant && <span>{it.merchant}</span>}
              <span className="uppercase tracking-wider">Cancelled</span>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function DoneView({ cat }: { cat: "all" | ItemCategory }) {
  const fn = useServerFn(listWins);
  const { data, isLoading } = useQuery({
    queryKey: ["wins"],
    queryFn: async () => (await fn()) as unknown as Win[],
    refetchInterval: 30_000,
  });

  const all = data ?? [];
  const wins = all.filter((w) => cat === "all" || w.category === cat);
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

  const byWeek = new Map<string, Win[]>();
  for (const w of wins) {
    if (!w.completed_at) continue;
    const key = format(startOfWeek(new Date(w.completed_at), { weekStartsOn: 1 }), "yyyy-MM-dd");
    const arr = byWeek.get(key) ?? [];
    arr.push(w);
    byWeek.set(key, arr);
  }

  return (
    <>
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
            Mark something done above and it'll show up here.
          </p>
        </Card>
      )}

      {Array.from(byWeek.entries()).map(([weekKey, list]) => (
        <WeekGroup key={weekKey} weekKey={weekKey} list={list} />
      ))}
    </>
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

function Group({ label, items, accent }: { label: string; items: Item[]; accent: Assignee }) {
  if (items.length === 0) return null;
  const dot =
    accent === "mom" ? "bg-[color:var(--color-mom)]" :
    accent === "dad" ? "bg-[color:var(--color-dad)]" : "bg-muted-foreground";
  return (
    <section className="mb-5">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">{label}</h2>
        <span className="text-xs text-muted-foreground">· {items.length}</span>
      </div>
      <div className="space-y-2">
        {items.map((it) => <ItemRow key={it.id} item={it} />)}
      </div>
    </section>
  );
}

function ItemRow({ item }: { item: Item }) {
  const dueLike = item.due_at ?? item.expires_at ?? item.rsvp_by;
  const dueLabel = item.due_at ? "Due" : item.expires_at ? "Expires" : item.rsvp_by ? "RSVP" : null;
  const isToday = dueLike
    ? new Date(dueLike).toDateString() === new Date().toDateString()
    : false;
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-base leading-tight flex-1">{item.title}</h3>
        <CategoryChip cat={item.category} />
      </div>
      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
        {item.merchant && <span>{item.merchant}</span>}
        {item.amount != null && <span>{item.amount} {item.currency ?? ""}</span>}
        {dueLike && dueLabel && (
          <span className={isToday ? "text-primary font-medium" : ""}>
            {dueLabel}: {format(new Date(dueLike), "MMM d")}{isToday ? " · today" : ""}
          </span>
        )}
      </div>
      <ItemActions itemId={item.id} itemTitle={item.title} currentDate={dueLike} />
    </Card>
  );
}

function CategoryChip({ cat }: { cat: ItemCategory }) {
  return (
    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
      {cat}
    </span>
  );
}

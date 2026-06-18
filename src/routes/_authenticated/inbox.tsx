import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { useState } from "react";

import { PageShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ItemActions } from "@/components/item-actions";
import { listItems } from "@/lib/agent.functions";
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
  const [cat, setCat] = useState<"all" | ItemCategory>("all");
  const open = (data ?? []).filter((i) => (i.status ?? "open") === "open");
  const filtered = open.filter((i) => cat === "all" || i.category === cat);
  const mom = filtered.filter((i) => i.assignee === "mom");
  const dad = filtered.filter((i) => i.assignee === "dad");
  const either = filtered.filter((i) => i.assignee === "either");

  return (
    <PageShell title="Inbox">
      <Tabs value={cat} onValueChange={(v) => setCat(v as "all" | ItemCategory)} className="mb-4">
        <TabsList className="w-full justify-start overflow-x-auto">
          {CATS.map((c) => (
            <TabsTrigger key={c.key} value={c.key} className="text-xs">{c.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && data.length === 0 && (
        <Card className="p-6 text-center">
          <p className="font-serif text-lg">Nothing here yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Head to Capture to add a receipt, bill, or coupon.
          </p>
        </Card>
      )}

      <Group label="Mom" items={mom} accent="mom" />
      <Group label="Dad" items={dad} accent="dad" />
      <Group label="Either" items={either} accent="either" />
    </PageShell>
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

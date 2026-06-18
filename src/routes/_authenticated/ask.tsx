import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, Search } from "lucide-react";

import { PageShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { askMemory } from "@/lib/agent.functions";

export const Route = createFileRoute("/_authenticated/ask")({
  head: () => ({ meta: [{ title: "Ask — Inbox" }] }),
  component: AskPage,
});

type Match = {
  id: string;
  title: string;
  category: string;
  topic: string | null;
  assignee: string;
  merchant: string | null;
  amount: number | null;
  due_at: string | null;
  expires_at: string | null;
  status: string | null;
  completed_at: string | null;
  similarity: number;
};

function AskPage() {
  const ask = useServerFn(askMemory);
  const [q, setQ] = useState("");
  const m = useMutation({
    mutationFn: async () => (await ask({ data: { q } })) as unknown as Match[],
  });

  return (
    <PageShell title="Ask">
      <p className="text-sm text-muted-foreground mb-4">
        Search everything you've saved. Try <em>"do I have a plumbing coupon?"</em>
      </p>
      <form
        onSubmit={(e) => { e.preventDefault(); if (q.trim()) m.mutate(); }}
        className="flex gap-2 mb-4"
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question…" />
        <Button type="submit" disabled={m.isPending || !q.trim()}>
          {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </form>
      {m.data && m.data.length === 0 && (
        <p className="text-sm text-muted-foreground">No matches.</p>
      )}
      <div className="space-y-2">
        {m.data?.map((r) => {
          const status = r.status ?? "open";
          const badgeCls =
            status === "done"
              ? "bg-emerald-500/15 text-emerald-700"
              : status === "cancelled"
                ? "bg-muted text-muted-foreground line-through"
                : "bg-amber-500/15 text-amber-700";
          return (
            <Card key={r.id} className="p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-serif text-base flex-1">{r.title}</h3>
                <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${badgeCls}`}>
                  {status === "done" ? "✓ Done" : status}
                </span>
                <span className="text-[10px] text-muted-foreground">{Math.round(r.similarity * 100)}%</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {r.category}{r.topic ? ` · ${r.topic}` : ""}{r.merchant ? ` · ${r.merchant}` : ""}
                {r.completed_at ? ` · done ${new Date(r.completed_at).toLocaleDateString()}` : ""}
              </p>
            </Card>
          );
        })}
      </div>
    </PageShell>
  );
}

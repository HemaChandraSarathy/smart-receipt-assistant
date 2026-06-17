import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";

import { PageShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { listRecentRuns } from "@/lib/agent.functions";

export const Route = createFileRoute("/_authenticated/runs")({
  head: () => ({ meta: [{ title: "Runs — Inbox" }] }),
  component: RunsPage,
});

type Run = {
  id: string;
  status: "running" | "awaiting_approval" | "done" | "failed" | "cancelled";
  input_kind: string;
  current_node: string | null;
  started_at: string;
  ended_at: string | null;
  error: string | null;
  langsmith_url: string | null;
};

function RunsPage() {
  const list = useServerFn(listRecentRuns);
  const { data } = useQuery({
    queryKey: ["runs"],
    queryFn: async () => (await list()) as unknown as Run[],
    refetchInterval: 5000,
  });

  return (
    <PageShell title="Runs">
      <p className="text-sm text-muted-foreground mb-4">
        Every agent run with its trace. Tap to see node-by-node.
      </p>
      {data?.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">No runs yet.</Card>
      )}
      <div className="space-y-2">
        {data?.map((r) => (
          <Link key={r.id} to="/runs/$runId" params={{ runId: r.id }}>
            <Card className="p-4 hover:border-primary transition-colors">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">{r.input_kind}</span>
                <StatusChip status={r.status} />
              </div>
              <p className="text-sm mt-1">
                {r.current_node ?? (r.status === "done" ? "Completed" : r.status)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatDistanceToNow(new Date(r.started_at), { addSuffix: true })}
              </p>
              {r.error && <p className="text-xs text-destructive mt-1">{r.error}</p>}
            </Card>
          </Link>
        ))}
      </div>
    </PageShell>
  );
}

function StatusChip({ status }: { status: Run["status"] }) {
  const cls = {
    running: "bg-accent text-accent-foreground",
    awaiting_approval: "bg-primary/15 text-primary",
    done: "bg-[color:var(--color-dad)]/15 text-[color:var(--color-dad)]",
    failed: "bg-destructive/15 text-destructive",
    cancelled: "bg-muted text-muted-foreground",
  }[status];
  return <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full ${cls}`}>{status.replace("_", " ")}</span>;
}

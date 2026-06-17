import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { ChevronLeft, ExternalLink } from "lucide-react";

import { PageShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { getRun } from "@/lib/agent.functions";

export const Route = createFileRoute("/_authenticated/runs/$runId")({
  head: () => ({ meta: [{ title: "Run — Inbox" }] }),
  component: RunDetail,
});

function RunDetail() {
  const { runId } = Route.useParams();
  const fn = useServerFn(getRun);
  const { data } = useQuery({
    queryKey: ["run", runId],
    queryFn: async () => fn({ data: { runId } }),
    refetchInterval: 4000,
  });

  return (
    <PageShell title="Run">
      <Link to="/runs" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-3">
        <ChevronLeft className="h-4 w-4 mr-1" /> All runs
      </Link>
      {data?.run && (
        <Card className="p-4 mb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{data.run.input_kind}</p>
          <p className="text-sm mt-1">Status: <span className="font-medium">{data.run.status}</span></p>
          <p className="text-xs text-muted-foreground mt-1">
            Started {format(new Date(data.run.started_at), "MMM d, p")}
          </p>
          {data.run.langsmith_url && (
            <a
              href={data.run.langsmith_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center text-xs text-primary mt-2 hover:underline"
            >
              View in LangSmith <ExternalLink className="h-3 w-3 ml-1" />
            </a>
          )}
        </Card>
      )}

      <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Timeline</h2>
      <div className="space-y-2">
        {(data?.events ?? []).map((e) => {
          const payload = (e.payload ?? {}) as Record<string, unknown>;
          return (
            <Card key={e.id} className="p-3">
              <div className="flex items-baseline justify-between">
                <span className="font-medium text-sm">{e.node}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{e.kind}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">{format(new Date(e.ts), "p")}</p>
              {Object.keys(payload).length > 0 && (
                <pre className="mt-2 text-[11px] bg-muted p-2 rounded overflow-x-auto max-h-40">
                  {JSON.stringify(payload, null, 2)}
                </pre>
              )}
            </Card>
          );
        })}
        {data && data.events.length === 0 && (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        )}
      </div>
    </PageShell>
  );
}

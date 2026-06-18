import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import {
  CheckCircle2,
  ChevronLeft,
  Circle,
  ExternalLink,
  Eye,
  Loader2,
  PauseCircle,
  Save,
  CalendarPlus,
  Bell,
  Tag,
  Users,
  XCircle,
} from "lucide-react";
import { useState } from "react";

import { PageShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getRun } from "@/lib/agent.functions";

export const Route = createFileRoute("/_authenticated/runs/$runId")({
  head: () => ({ meta: [{ title: "Run — Inbox" }] }),
  component: RunDetail,
});

type AgentKey = "extract" | "assign" | "approveSave" | "approveCalendar" | "scheduleFollowup";

const AGENT_ORDER: AgentKey[] = ["extract", "assign", "approveSave", "approveCalendar", "scheduleFollowup"];

const AGENT_META: Record<AgentKey, { label: string; sub: string; icon: typeof Eye }> = {
  extract: { label: "Extract", sub: "Vision · Gemini 2.5 Flash", icon: Eye },
  assign: { label: "Assign", sub: "Rules · Mom / Dad", icon: Users },
  approveSave: { label: "Save", sub: "Database (auto if conf ≥ 0.85)", icon: Save },
  approveCalendar: { label: "Calendar", sub: "Google Calendar · primary", icon: CalendarPlus },
  scheduleFollowup: { label: "Follow-up", sub: "Reminder 24h before", icon: Bell },
};

type Event = {
  id: string;
  node: string;
  kind: "start" | "end" | "tool" | "error" | "interrupt" | "retry";
  payload: Record<string, unknown> | null;
  ts: string;
};

function statusFor(node: AgentKey, events: Event[]): {
  status: "pending" | "running" | "waiting" | "done" | "error" | "skipped";
  startTs?: string;
  endTs?: string;
  payload?: Record<string, unknown>;
} {
  const mine = events.filter((e) => e.node === node);
  if (mine.length === 0) return { status: "pending" };
  const start = mine.find((e) => e.kind === "start");
  const end = mine.find((e) => e.kind === "end");
  const interrupt = mine.find((e) => e.kind === "interrupt");
  const error = mine.find((e) => e.kind === "error");
  if (error && !end) return { status: "error", startTs: start?.ts, payload: (error.payload ?? undefined) as Record<string, unknown> | undefined };
  if (interrupt && !end) return { status: "waiting", startTs: start?.ts, payload: (interrupt.payload ?? undefined) as Record<string, unknown> | undefined };
  if (end) return { status: "done", startTs: start?.ts, endTs: end.ts, payload: (end.payload ?? undefined) as Record<string, unknown> | undefined };
  if (start) return { status: "running", startTs: start.ts };
  return { status: "pending" };
}

function durationMs(start?: string, end?: string) {
  if (!start || !end) return null;
  return new Date(end).getTime() - new Date(start).getTime();
}

function RunDetail() {
  const { runId } = Route.useParams();
  const fn = useServerFn(getRun);
  const { data } = useQuery({
    queryKey: ["run", runId],
    queryFn: async () => fn({ data: { runId } }),
    refetchInterval: 3000,
  });

  const events = (data?.events ?? []) as Event[];
  const runStatus = data?.run?.status;

  return (
    <PageShell title="Run">
      <Link to="/runs" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-3">
        <ChevronLeft className="h-4 w-4 mr-1" /> All runs
      </Link>

      {data?.run && (
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{data.run.input_kind}</p>
            <RunStatusPill status={runStatus ?? "unknown"} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Started {format(new Date(data.run.started_at), "MMM d, p")}
            {data.run.ended_at ? ` · ended ${format(new Date(data.run.ended_at), "p")}` : ""}
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

      <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Agents</h2>
      <ol className="relative space-y-3 ml-4">
        <span aria-hidden className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
        {AGENT_ORDER.map((key) => (
          <AgentRow key={key} agentKey={key} events={events} />
        ))}
      </ol>

      {events.length === 0 && (
        <p className="text-sm text-muted-foreground mt-3">No events yet.</p>
      )}
    </PageShell>
  );
}

function RunStatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: "bg-blue-500/15 text-blue-600",
    awaiting_approval: "bg-amber-500/15 text-amber-600",
    completed: "bg-emerald-500/15 text-emerald-600",
    failed: "bg-rose-500/15 text-rose-600",
  };
  const cls = map[status] ?? "bg-muted text-muted-foreground";
  return <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full ${cls}`}>{status}</span>;
}

function AgentRow({ agentKey, events }: { agentKey: AgentKey; events: Event[] }) {
  const meta = AGENT_META[agentKey];
  const Icon = meta.icon;
  const st = statusFor(agentKey, events);
  const [open, setOpen] = useState(st.status === "waiting" || st.status === "error");
  const dur = durationMs(st.startTs, st.endTs);

  const dotIcon =
    st.status === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> :
    st.status === "running" ? <Loader2 className="h-4 w-4 text-blue-500 animate-spin" /> :
    st.status === "waiting" ? <PauseCircle className="h-4 w-4 text-amber-500" /> :
    st.status === "error" ? <XCircle className="h-4 w-4 text-rose-500" /> :
    <Circle className="h-4 w-4 text-muted-foreground" />;

  // Pull human-friendly summary from payload for done states
  const summary = renderSummary(agentKey, st.payload);

  return (
    <li className="relative pl-6">
      <span className="absolute left-0 top-1.5 flex items-center justify-center w-4 h-4 bg-background rounded-full">
        {dotIcon}
      </span>
      <Card className="p-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full text-left"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-medium text-sm">{meta.label}</span>
              {dur != null && (
                <span className="text-[10px] text-muted-foreground">· {(dur / 1000).toFixed(2)}s</span>
              )}
            </div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {st.status}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{meta.sub}</p>
          {summary && <div className="mt-2 text-sm">{summary}</div>}
          {st.status === "waiting" && (
            <Link
              to="/approvals"
              className="inline-flex items-center text-xs text-primary hover:underline mt-2"
              onClick={(e) => e.stopPropagation()}
            >
              Review in Approvals <ExternalLink className="h-3 w-3 ml-1" />
            </Link>
          )}
        </button>

        {open && st.payload && Object.keys(st.payload).length > 0 && (
          <pre className="mt-2 text-[11px] bg-muted p-2 rounded overflow-x-auto max-h-56">
            {JSON.stringify(st.payload, null, 2)}
          </pre>
        )}
      </Card>
    </li>
  );
}

function renderSummary(key: AgentKey, payload?: Record<string, unknown>) {
  if (!payload) return null;
  if (key === "extract") {
    const ex = (payload as { extracted?: Record<string, unknown> }).extracted;
    if (!ex) return null;
    const conf = typeof ex.category_confidence === "number" ? ex.category_confidence : null;
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted">
          <Tag className="h-3 w-3" />{String(ex.category ?? "—")}
        </span>
        {ex.title != null && <span className="text-foreground">{String(ex.title)}</span>}
        {conf != null && <span className="text-muted-foreground">· conf {Math.round(conf * 100)}%</span>}
      </div>
    );
  }
  if (key === "assign") {
    const a = (payload as { assignment?: { assignee?: string; confidence?: number; reasoning?: string } }).assignment;
    if (!a) return null;
    return (
      <div className="text-xs text-muted-foreground">
        <span className="text-foreground font-medium uppercase">{a.assignee}</span>
        {typeof a.confidence === "number" && <> · {Math.round(a.confidence * 100)}%</>}
        {a.reasoning && <> · {a.reasoning}</>}
      </div>
    );
  }
  if (key === "approveSave") {
    if ((payload as { auto?: boolean }).auto) return <p className="text-xs text-emerald-600">Auto-approved (high confidence)</p>;
    if ((payload as { itemId?: string }).itemId) return <p className="text-xs text-muted-foreground">Saved to inbox</p>;
    return null;
  }
  if (key === "approveCalendar") {
    if ((payload as { eventId?: string }).eventId) return <p className="text-xs text-muted-foreground">Event created</p>;
    if ((payload as { proposal?: unknown }).proposal) return <p className="text-xs text-amber-600">Waiting for your approval</p>;
    return null;
  }
  if (key === "scheduleFollowup") {
    const at = (payload as { nudgeAt?: string }).nudgeAt;
    if (at) return <p className="text-xs text-muted-foreground">Nudge {format(new Date(at), "MMM d, p")}</p>;
    return null;
  }
  return null;
}

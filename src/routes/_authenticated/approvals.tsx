import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { format } from "date-fns";
import { Check, X, Pencil, CalendarPlus, Save, Loader2 } from "lucide-react";

import { PageShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listPendingApprovals, resumeRun } from "@/lib/agent.functions";
import { toast } from "sonner";
import type { ApprovalProposal, Assignee } from "@/lib/agent/types";

export const Route = createFileRoute("/_authenticated/approvals")({
  head: () => ({ meta: [{ title: "Approvals — Inbox" }] }),
  component: ApprovalsPage,
});

type Approval = {
  id: string;
  run_id: string;
  node: string;
  action_kind: string;
  proposal: ApprovalProposal;
  created_at: string;
};

function ApprovalsPage() {
  const list = useServerFn(listPendingApprovals);
  const { data, isLoading } = useQuery({
    queryKey: ["approvals"],
    queryFn: async () => (await list()) as unknown as Approval[],
    refetchInterval: 8000,
  });

  return (
    <PageShell title="Approvals">
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && data.length === 0 && (
        <Card className="p-6 text-center">
          <p className="font-serif text-lg">All caught up</p>
          <p className="text-sm text-muted-foreground mt-1">No pending approvals.</p>
        </Card>
      )}
      <div className="space-y-3">
        {data?.map((a) => <ApprovalCard key={a.id} approval={a} />)}
      </div>
    </PageShell>
  );
}

function ApprovalCard({ approval }: { approval: Approval }) {
  const resume = useServerFn(resumeRun);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [patch, setPatch] = useState<Record<string, unknown>>({});

  const decide = useMutation({
    mutationFn: async (action: "approve" | "edit" | "reject") =>
      resume({
        data: {
          runId: approval.run_id,
          approvalId: approval.id,
          decision: { action, patch: action === "edit" ? patch : undefined },
        },
      }),
    onSuccess: () => {
      toast.success("Decision recorded");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (approval.proposal.kind === "save_item") {
    const { item, assignment } = approval.proposal;
    const merged = { ...item, assignee: assignment.assignee, ...patch } as typeof item & { assignee: Assignee };
    return (
      <Card className="p-5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Save {item.category}
          </span>
          <AssigneeBadge a={(patch.assignee as Assignee) ?? assignment.assignee} />
        </div>
        <h3 className="font-serif text-lg leading-tight">{merged.title}</h3>
        {merged.merchant && <p className="text-sm text-muted-foreground">{merged.merchant}</p>}
        <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
          {item.amount != null && (
            <div><span className="text-muted-foreground">Amount</span><div>{item.amount} {item.currency ?? "USD"}</div></div>
          )}
          {item.due_at && <DateChip label="Due" iso={item.due_at} />}
          {item.expires_at && <DateChip label="Expires" iso={item.expires_at} />}
          {item.rsvp_by && <DateChip label="RSVP by" iso={item.rsvp_by} />}
        </div>
        {item.description && <p className="text-sm mt-3">{item.description}</p>}
        <p className="text-xs text-muted-foreground mt-3">
          Assigned via: {assignment.reasoning} ({Math.round(assignment.confidence * 100)}%)
        </p>

        {editing && (
          <div className="mt-4 space-y-2 border-t border-border pt-3">
            <div>
              <Label className="text-xs">Title</Label>
              <Input
                defaultValue={item.title}
                onChange={(e) => setPatch((p) => ({ ...p, title: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Assignee</Label>
              <Select
                defaultValue={assignment.assignee}
                onValueChange={(v) => setPatch((p) => ({ ...p, assignee: v as Assignee }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mom">Mom</SelectItem>
                  <SelectItem value="dad">Dad</SelectItem>
                  <SelectItem value="either">Either</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => decide.mutate("reject")}
            disabled={decide.isPending}
          ><X className="h-4 w-4 mr-1" /> Skip</Button>
          {!editing ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditing(true)}
              disabled={decide.isPending}
            ><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
          ) : (
            <Button
              size="sm"
              onClick={() => decide.mutate("edit")}
              disabled={decide.isPending}
            ><Save className="h-4 w-4 mr-1" /> Save edits</Button>
          )}
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => decide.mutate("approve")}
            disabled={decide.isPending}
          >{decide.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />} Approve</Button>
        </div>
      </Card>
    );
  }

  // calendar (narrowed)
  if (approval.proposal.kind !== "create_calendar_event") return null;
  const cal = approval.proposal;
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-1">
        <CalendarPlus className="h-4 w-4 text-primary" />
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Create calendar event</span>
      </div>
      <h3 className="font-serif text-lg leading-tight">{cal.summary}</h3>
      <p className="text-sm text-muted-foreground mt-1">
        {format(new Date(cal.startISO), "EEE MMM d, p")}
      </p>
      {cal.description && <p className="text-sm mt-2 whitespace-pre-wrap">{cal.description}</p>}
      <div className="flex gap-2 mt-4">
        <Button variant="outline" size="sm" onClick={() => decide.mutate("reject")} disabled={decide.isPending}>
          <X className="h-4 w-4 mr-1" /> Skip
        </Button>
        <Button size="sm" className="ml-auto" onClick={() => decide.mutate("approve")} disabled={decide.isPending}>
          {decide.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />} Add to calendar
        </Button>
      </div>
    </Card>
  );
}

function DateChip({ label, iso }: { label: string; iso: string }) {
  const d = new Date(iso);
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <div>{isNaN(d.getTime()) ? iso : format(d, "MMM d, yyyy")}</div>
    </div>
  );
}

function AssigneeBadge({ a }: { a: Assignee }) {
  const cls =
    a === "mom"
      ? "bg-[color:var(--color-mom)]/15 text-[color:var(--color-mom)]"
      : a === "dad"
        ? "bg-[color:var(--color-dad)]/15 text-[color:var(--color-dad)]"
        : "bg-muted text-muted-foreground";
  return <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full ${cls}`}>{a}</span>;
}

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { format } from "date-fns";
import { Check, X, CalendarPlus, Loader2 } from "lucide-react";

import { PageShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

// Datetime helpers for <input type="datetime-local">
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToISO(v: string): string {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}

function ApprovalCard({ approval }: { approval: Approval }) {
  const resume = useServerFn(resumeRun);
  const qc = useQueryClient();
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

  // Treat any field change as an "edit" submission so the patch reaches the server.
  const hasEdits = Object.keys(patch).length > 0;
  const submitAction: "edit" | "approve" = hasEdits ? "edit" : "approve";

  if (approval.proposal.kind === "save_item") {
    const { item, assignment } = approval.proposal;
    return (
      <Card className="p-5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Save {item.category}
          </span>
          <AssigneeBadge a={(patch.assignee as Assignee) ?? assignment.assignee} />
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Edit any field before approving — your changes save to the item and the calendar event.
        </p>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title</Label>
            <Input
              defaultValue={item.title}
              onChange={(e) => setPatch((p) => ({ ...p, title: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Merchant</Label>
              <Input
                defaultValue={item.merchant ?? ""}
                onChange={(e) => setPatch((p) => ({ ...p, merchant: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Amount</Label>
              <Input
                type="number"
                step="0.01"
                defaultValue={item.amount ?? ""}
                onChange={(e) => setPatch((p) => ({ ...p, amount: e.target.value === "" ? null : Number(e.target.value) }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">
                {item.due_at ? "Due" : item.expires_at ? "Expires" : item.rsvp_by ? "RSVP by" : "Due"}
              </Label>
              <Input
                type="datetime-local"
                defaultValue={isoToLocalInput(item.due_at ?? item.expires_at ?? item.rsvp_by)}
                onChange={(e) => {
                  const iso = localInputToISO(e.target.value);
                  const key = item.due_at ? "due_at" : item.expires_at ? "expires_at" : item.rsvp_by ? "rsvp_by" : "due_at";
                  setPatch((p) => ({ ...p, [key]: iso }));
                }}
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
          <div>
            <Label className="text-xs">Notes for the calendar event</Label>
            <Textarea
              placeholder="Anything you want on the calendar event…"
              defaultValue={item.description ?? ""}
              onChange={(e) => setPatch((p) => ({ ...p, description: e.target.value }))}
              rows={3}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-3">
          Assigned via: {assignment.reasoning} ({Math.round(assignment.confidence * 100)}%)
        </p>

        <div className="flex gap-2 mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => decide.mutate("reject")}
            disabled={decide.isPending}
          ><X className="h-4 w-4 mr-1" /> Skip</Button>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => decide.mutate(submitAction)}
            disabled={decide.isPending}
          >{decide.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />} Approve & save to calendar</Button>
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
      <p className="text-xs text-muted-foreground mb-3">
        Edit any field before adding it to your calendar.
      </p>

      <div className="space-y-3">
        <div>
          <Label className="text-xs">Title</Label>
          <Input
            defaultValue={cal.summary}
            onChange={(e) => setPatch((p) => ({ ...p, summary: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Start</Label>
            <Input
              type="datetime-local"
              defaultValue={isoToLocalInput(cal.startISO)}
              onChange={(e) => setPatch((p) => ({ ...p, startISO: localInputToISO(e.target.value) }))}
            />
          </div>
          <div>
            <Label className="text-xs">End</Label>
            <Input
              type="datetime-local"
              defaultValue={isoToLocalInput(cal.endISO)}
              onChange={(e) => setPatch((p) => ({ ...p, endISO: localInputToISO(e.target.value) }))}
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Notes for the calendar event</Label>
          <Textarea
            defaultValue={cal.description ?? ""}
            onChange={(e) => setPatch((p) => ({ ...p, description: e.target.value }))}
            rows={4}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-3">
        Originally: {format(new Date(cal.startISO), "EEE MMM d, p")}
      </p>

      <div className="flex gap-2 mt-4">
        <Button variant="outline" size="sm" onClick={() => decide.mutate("reject")} disabled={decide.isPending}>
          <X className="h-4 w-4 mr-1" /> Skip
        </Button>
        <Button size="sm" className="ml-auto" onClick={() => decide.mutate(submitAction)} disabled={decide.isPending}>
          {decide.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />} Approve & add to calendar
        </Button>
      </div>
    </Card>
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

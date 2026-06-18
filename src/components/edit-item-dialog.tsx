import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateItem } from "@/lib/agent.functions";
import type { Assignee } from "@/lib/agent/types";

function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EditItemDialog({
  itemId,
  initial,
}: {
  itemId: string;
  initial: {
    title: string;
    merchant: string | null;
    amount: number | null;
    description?: string | null;
    assignee: Assignee;
    due_at: string | null;
  };
}) {
  const qc = useQueryClient();
  const fn = useServerFn(updateItem);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initial.title);
  const [merchant, setMerchant] = useState(initial.merchant ?? "");
  const [amount, setAmount] = useState<string>(initial.amount?.toString() ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [assignee, setAssignee] = useState<Assignee>(initial.assignee);
  const [dueLocal, setDueLocal] = useState(isoToLocal(initial.due_at));

  const m = useMutation({
    mutationFn: () =>
      fn({
        data: {
          itemId,
          title,
          merchant: merchant.trim() === "" ? null : merchant,
          amount: amount === "" ? null : Number(amount),
          description: description.trim() === "" ? null : description,
          assignee,
          due_at: dueLocal ? new Date(dueLocal).toISOString() : null,
        },
      }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["calendar-items"] });
      qc.invalidateQueries({ queryKey: ["gcal-events"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error("Couldn't save", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Edit">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>Changes also sync to the linked calendar event.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Merchant</Label>
              <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Amount</Label>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Date</Label>
              <Input
                type="datetime-local"
                value={dueLocal}
                onChange={(e) => setDueLocal(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Assignee</Label>
              <Select value={assignee} onValueChange={(v) => setAssignee(v as Assignee)}>
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
            <Label className="text-xs">Notes</Label>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={m.isPending}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            {m.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

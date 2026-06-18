import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, RotateCcw, X, CalendarIcon } from "lucide-react";
import { format, addDays } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { markItemDone, rescheduleItem, cancelItem } from "@/lib/agent.functions";

const INVALIDATE_KEYS = [["items"], ["calendar-items"], ["wins"], ["notifications"]];

export function ItemActions({
  itemId,
  itemTitle,
  currentDate,
}: {
  itemId: string;
  itemTitle: string;
  currentDate: string | null;
}) {
  const qc = useQueryClient();
  const doneFn = useServerFn(markItemDone);
  const rescheduleFn = useServerFn(rescheduleItem);
  const cancelFn = useServerFn(cancelItem);
  const [date, setDate] = useState<Date | undefined>(
    currentDate ? addDays(new Date(currentDate), 1) : addDays(new Date(), 1),
  );
  const [popOpen, setPopOpen] = useState(false);

  const invalidate = () => {
    for (const k of INVALIDATE_KEYS) qc.invalidateQueries({ queryKey: k });
  };

  const doneM = useMutation({
    mutationFn: () => doneFn({ data: { itemId } }),
    onSuccess: () => {
      toast.success("Done 🎉", { description: itemTitle });
      invalidate();
    },
    onError: (e: Error) => toast.error("Couldn't mark done", { description: e.message }),
  });

  const rescheduleM = useMutation({
    mutationFn: (d: Date) => rescheduleFn({ data: { itemId, newDateISO: d.toISOString() } }),
    onSuccess: (_r, d) => {
      toast.success("Moved", { description: `${itemTitle} → ${format(d, "MMM d")}` });
      invalidate();
      setPopOpen(false);
    },
    onError: (e: Error) => toast.error("Couldn't reschedule", { description: e.message }),
  });

  const cancelM = useMutation({
    mutationFn: () => cancelFn({ data: { itemId } }),
    onSuccess: () => {
      toast("Cancelled", { description: `${itemTitle} — calendar cleared` });
      invalidate();
    },
    onError: (e: Error) => toast.error("Couldn't cancel", { description: e.message }),
  });

  const busy = doneM.isPending || rescheduleM.isPending || cancelM.isPending;

  return (
    <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-border">
      <Button
        size="sm"
        variant="default"
        disabled={busy}
        onClick={() => doneM.mutate()}
        className="h-8"
      >
        <Check className="h-3.5 w-3.5 mr-1" /> Done
      </Button>

      <Popover open={popOpen} onOpenChange={setPopOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" disabled={busy} className="h-8">
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reschedule
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={setDate}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
          <div className="p-2 flex items-center justify-between border-t border-border">
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <CalendarIcon className="h-3 w-3" />
              {date ? format(date, "MMM d, yyyy") : "Pick a date"}
            </span>
            <Button
              size="sm"
              disabled={!date || rescheduleM.isPending}
              onClick={() => date && rescheduleM.mutate(date)}
            >
              Save
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            className="h-8 text-muted-foreground hover:text-destructive"
          >
            <X className="h-3.5 w-3.5 mr-1" /> Cancel
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this?</AlertDialogTitle>
            <AlertDialogDescription>
              "{itemTitle}" will be marked cancelled and removed from your Google Calendar.
              You can still find it in Wins → Cancelled later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => cancelM.mutate()}>Cancel event</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { Bell, BellOff, CalendarDays, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteGoogleCalendarEvent, listGoogleCalendarEvents } from "@/lib/agent.functions";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({ meta: [{ title: "Calendar — Sarma Household" }] }),
  component: CalendarPage,
});

function CalendarPage() {
  const fn = useServerFn(listGoogleCalendarEvents);
  const deleteFn = useServerFn(deleteGoogleCalendarEvent);
  const qc = useQueryClient();
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["gcal-events"],
    queryFn: () => fn(),
    refetchInterval: 30_000,
  });

  const [pendingDelete, setPendingDelete] = useState<{ id: string; summary: string } | null>(null);

  const delMutation = useMutation({
    mutationFn: (eventId: string) => deleteFn({ data: { eventId } }),
    onSuccess: () => {
      toast.success("Event deleted from Google Calendar");
      void qc.invalidateQueries({ queryKey: ["gcal-events"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete event");
    },
    onSettled: () => setPendingDelete(null),
  });

  const events = data?.events ?? [];
  const connected = data?.connected;
  const error = (data as { error?: string } | undefined)?.error;

  return (
    <PageShell
      title="Calendar"
      action={
        <Button size="icon" variant="ghost" onClick={() => refetch()} aria-label="Refresh">
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      }
    >
      <Card className="p-3 mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <span>
            {connected === false
              ? "Calendar not connected"
              : "Primary Google Calendar · next 25 events"}
          </span>
        </div>
        <a
          href="https://calendar.google.com/calendar/u/0/r"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center text-xs text-primary hover:underline"
        >
          Open <ExternalLink className="h-3 w-3 ml-1" />
        </a>
      </Card>

      {error && (
        <Card className="p-3 mb-3 text-xs text-rose-600 break-all">{error}</Card>
      )}

      {events.length === 0 && !isFetching && (
        <p className="text-sm text-muted-foreground">No upcoming events.</p>
      )}

      <ul className="space-y-2">
        {events.map((ev) => {
          const start = ev.start ? new Date(ev.start) : null;
          const hasReminder =
            ev.reminders?.useDefault ||
            (ev.reminders?.overrides && ev.reminders.overrides.length > 0);
          const isDeleting = delMutation.isPending && delMutation.variables === ev.id;
          return (
            <li key={ev.id}>
              <Card className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{ev.summary}</p>
                    {start && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {format(start, "EEE, MMM d · p")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {ev.htmlLink && (
                      <a
                        href={ev.htmlLink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary inline-flex items-center"
                      >
                        Open <ExternalLink className="h-3 w-3 ml-0.5" />
                      </a>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-rose-600"
                      onClick={() => setPendingDelete({ id: ev.id, summary: ev.summary })}
                      disabled={isDeleting}
                      aria-label={`Delete ${ev.summary}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600">
                    <CalendarDays className="h-3 w-3" /> On calendar
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${
                      hasReminder
                        ? "bg-amber-500/10 text-amber-600"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {hasReminder ? <Bell className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
                    {hasReminder
                      ? ev.reminders?.useDefault
                        ? "Default reminder"
                        : `${ev.reminders?.overrides?.[0]?.minutes}m before`
                      : "No reminder"}
                  </span>
                </div>
                {ev.description && (
                  <p className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap line-clamp-3">
                    {ev.description}
                  </p>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this calendar event?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.summary
                ? `“${pendingDelete.summary}” will be removed from your Google Calendar. This can’t be undone from here.`
                : "This will be removed from your Google Calendar."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDelete && delMutation.mutate(pendingDelete.id)}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

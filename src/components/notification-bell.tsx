import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listNotifications,
  markNotificationRead,
  softDeleteNotification,
  clearReadNotifications,
} from "@/lib/agent.functions";

type Notif = {
  id: string;
  item_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
};

export function NotificationBell() {
  const qc = useQueryClient();
  const listFn = useServerFn(listNotifications);
  const markFn = useServerFn(markNotificationRead);
  const delFn = useServerFn(softDeleteNotification);
  const clearReadFn = useServerFn(clearReadNotifications);
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await listFn()) as unknown as Notif[],
    refetchInterval: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["notifications"] });

  const markAll = useMutation({
    mutationFn: () => markFn({ data: { all: true } }),
    onSuccess: invalidate,
  });
  const clearRead = useMutation({
    mutationFn: () => clearReadFn(),
    onSuccess: invalidate,
  });
  const delOne = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: invalidate,
  });

  const list = data ?? [];
  const unread = list.filter((n) => !n.read_at).length;
  const hasRead = list.some((n) => n.read_at);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-[70vh] overflow-y-auto p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-popover gap-2">
          <span className="text-sm font-medium">Reminders</span>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => markAll.mutate()}
              >
                Mark all read
              </button>
            )}
            {hasRead && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => clearRead.mutate()}
              >
                Clear read
              </button>
            )}
          </div>
        </div>
        {list.length === 0 ? (
          <p className="px-3 py-6 text-xs text-center text-muted-foreground">
            Nothing to nudge you about — great job.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((n) => (
              <li
                key={n.id}
                className={`px-3 py-2 group ${!n.read_at ? "bg-accent/30" : ""}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium leading-tight flex-1">{n.title}</p>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </span>
                  <button
                    type="button"
                    aria-label="Delete notification"
                    className="text-muted-foreground hover:text-destructive opacity-60 hover:opacity-100"
                    onClick={() => delOne.mutate(n.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {n.body && <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

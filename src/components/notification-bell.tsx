import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { listNotifications, markNotificationRead } from "@/lib/agent.functions";

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
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await listFn()) as unknown as Notif[],
    refetchInterval: 30_000,
  });

  const markAll = useMutation({
    mutationFn: () => markFn({ data: { all: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const list = data ?? [];
  const unread = list.filter((n) => !n.read_at).length;

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
        <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-popover">
          <span className="text-sm font-medium">Reminders</span>
          {unread > 0 && (
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </button>
          )}
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
                className={`px-3 py-2 ${!n.read_at ? "bg-accent/30" : ""}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium leading-tight">{n.title}</p>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </span>
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

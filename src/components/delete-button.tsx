import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Fn = (args: { data: { id: string } }) => Promise<unknown>;

const INVALIDATE_KEYS = [
  ["items"],
  ["wins"],
  ["calendar-items"],
  ["approvals"],
  ["runs"],
  ["notifications"],
  ["golden"],
  ["trash"],
];

export function DeleteButton({
  id,
  label,
  deleteFn,
  restoreFn,
  confirmTitle,
  confirmBody,
  size = "icon",
  variant = "ghost",
  className,
  iconOnly = true,
}: {
  id: string;
  label: string;
  deleteFn: Fn;
  restoreFn?: Fn;
  confirmTitle?: string;
  confirmBody?: string;
  size?: "icon" | "sm" | "default";
  variant?: "ghost" | "outline" | "destructive";
  className?: string;
  iconOnly?: boolean;
}) {
  const qc = useQueryClient();
  const del = useServerFn(deleteFn);
  const noopFn: Fn = async () => ({ ok: true });
  const restore = useServerFn(restoreFn ?? noopFn);
  const canRestore = !!restoreFn;



  const invalidate = () => {
    for (const k of INVALIDATE_KEYS) qc.invalidateQueries({ queryKey: k });
  };

  const m = useMutation({
    mutationFn: () => del({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast(`${label} deleted`, {
        description: canRestore ? "30 days in Trash before purge." : undefined,
        action: canRestore
          ? {

              label: "Undo",
              onClick: async () => {
                try {
                  await restore({ data: { id } });
                  invalidate();
                  toast.success("Restored");
                } catch (e) {
                  toast.error("Couldn't restore", { description: (e as Error).message });
                }
              },
            }
          : undefined,
      });
    },
    onError: (e: Error) => toast.error("Couldn't delete", { description: e.message }),
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size={size}
          variant={variant}
          disabled={m.isPending}
          className={className ?? "text-muted-foreground hover:text-destructive"}
          aria-label={`Delete ${label}`}
        >
          <Trash2 className={iconOnly ? "h-4 w-4" : "h-3.5 w-3.5 mr-1"} />
          {!iconOnly && "Delete"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmTitle ?? `Delete "${label}"?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {confirmBody ??
              "Moved to Trash. You can restore it for 30 days before it's gone forever."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep</AlertDialogCancel>
          <AlertDialogAction onClick={() => m.mutate()}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ClearAllButton({
  label,
  description,
  clearFn,
  invalidateKeys,
  variant = "ghost",
}: {
  label: string;
  description: string;
  clearFn: () => Promise<unknown>;
  invalidateKeys?: string[][];
  variant?: "ghost" | "outline" | "destructive";
}) {
  const qc = useQueryClient();
  const fn = useServerFn(clearFn as unknown as () => Promise<unknown>);
  const m = useMutation({
    mutationFn: () => (fn as () => Promise<unknown>)(),
    onSuccess: () => {
      const keys = invalidateKeys ?? INVALIDATE_KEYS;
      for (const k of keys) qc.invalidateQueries({ queryKey: k });
      toast(label, { description: "Done." });
    },
    onError: (e: Error) => toast.error("Couldn't clear", { description: e.message }),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant={variant} disabled={m.isPending} className="h-8 text-xs">
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label}?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => m.mutate()}>{label}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

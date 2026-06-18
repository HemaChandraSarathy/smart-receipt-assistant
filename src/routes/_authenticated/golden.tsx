// Admin surface for the golden-examples dataset.
// Add / edit / eval annotated extractions. Used to drive few-shot prompts
// and to measure regressions in the extractor.

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Play, Loader2, X, Image as ImageIcon, CheckCircle2, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import { PageShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  listGolden,
  upsertGolden,
  deleteGolden,
  runGoldenEval,
  getGoldenSignedUrl,
} from "@/lib/golden.functions";

export const Route = createFileRoute("/_authenticated/golden")({
  head: () => ({ meta: [{ title: "Golden — extractor dataset" }] }),
  component: GoldenPage,
});

type GoldenRow = {
  id: string;
  title: string;
  image_path: string | null;
  source_text: string | null;
  notes: string | null;
  expected_items: unknown[];
  expected_clarifications: unknown[];
  failure_tags: string[];
  last_eval: Record<string, unknown> | null;
  last_eval_at: string | null;
  created_at: string;
};

const FAILURE_TAG_OPTIONS = [
  "hallucinated_date",
  "missed_multi_task",
  "dropped_context",
  "missed_clarification",
  "wrong_amount",
  "wrong_assignee",
  "wrong_category",
];

function GoldenPage() {
  const list = useServerFn(listGolden);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["golden"],
    queryFn: async () => (await list()) as unknown as GoldenRow[],
  });
  const [editing, setEditing] = useState<GoldenRow | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <PageShell
      title="Golden dataset"
      action={
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      }
    >
      <p className="text-xs text-muted-foreground mb-3">
        Annotated examples of what the extractor SHOULD have produced. Used to few-shot the live extractor and to score regressions. Add more as you find them in the wild.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && data.length === 0 && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">No examples yet. Add one to start training.</p>
        </Card>
      )}

      <div className="space-y-3">
        {data?.map((row) => (
          <GoldenCard
            key={row.id}
            row={row}
            onEdit={() => setEditing(row)}
            onChange={() => qc.invalidateQueries({ queryKey: ["golden"] })}
          />
        ))}
      </div>

      {(creating || editing) && (
        <GoldenEditor
          row={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["golden"] });
          }}
        />
      )}
    </PageShell>
  );
}

function GoldenCard({ row, onEdit, onChange }: { row: GoldenRow; onEdit: () => void; onChange: () => void }) {
  const evalFn = useServerFn(runGoldenEval);
  const delFn = useServerFn(deleteGolden);
  const signFn = useServerFn(getGoldenSignedUrl);
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (row.image_path) {
      signFn({ data: { path: row.image_path } })
        .then((r) => alive && setThumb(r.url))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [row.image_path, signFn]);

  const runEval = useMutation({
    mutationFn: async () => evalFn({ data: { id: row.id } }),
    onSuccess: () => {
      toast.success("Eval done");
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => delFn({ data: { id: row.id } }),
    onSuccess: () => {
      toast.success("Deleted");
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const last = row.last_eval as
    | null
    | {
        ranAt?: string;
        expectedCount?: number;
        actualCount?: number;
        missedTasks?: number;
        collapsedToOne?: boolean;
        hallucinatedDate?: boolean;
        matchedAnyExpectedTitle?: boolean;
        hasRawText?: boolean;
        hasSourceQuote?: boolean;
        actualTitle?: string | null;
        actualDue?: string | null;
        error?: string | null;
      };

  return (
    <Card className="p-4">
      <div className="flex gap-3">
        <div className="h-20 w-16 flex-shrink-0 overflow-hidden rounded border bg-muted/40 flex items-center justify-center">
          {thumb ? (
            <img src={thumb} alt={row.title} className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-sm truncate">{row.title}</p>
            <span className="text-[10px] text-muted-foreground">
              {format(new Date(row.created_at), "MMM d")}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {row.expected_items.length} expected · {row.expected_clarifications.length} clarif.
          </p>
          {row.notes && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{row.notes}</p>}
          {row.failure_tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {row.failure_tags.map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px] font-normal">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {last && (
        <div className="mt-3 rounded-md border bg-muted/30 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Last eval</span>
            {last.ranAt && (
              <span className="text-[10px] text-muted-foreground">
                {format(new Date(last.ranAt), "MMM d, p")}
              </span>
            )}
          </div>
          {last.error ? (
            <p className="text-xs text-destructive">{last.error}</p>
          ) : (
            <>
              <ResultRow
                ok={!last.collapsedToOne}
                label={`Items: ${last.actualCount}/${last.expectedCount}${last.collapsedToOne ? " (collapsed)" : ""}`}
              />
              <ResultRow ok={!last.hallucinatedDate} label={last.hallucinatedDate ? `Hallucinated date: ${last.actualDue}` : "No date hallucinated"} />
              <ResultRow ok={!!last.matchedAnyExpectedTitle} label={last.matchedAnyExpectedTitle ? `Title matched: "${last.actualTitle}"` : `Title didn't match: "${last.actualTitle ?? "—"}"`} />
              <ResultRow ok={!!last.hasRawText} label={last.hasRawText ? "raw_text populated" : "raw_text missing"} />
              <ResultRow ok={!!last.hasSourceQuote} label={last.hasSourceQuote ? "source_quote populated" : "source_quote missing"} />
            </>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-3">
        <Button size="sm" variant="outline" onClick={onEdit} className="flex-1">
          Edit
        </Button>
        <Button size="sm" onClick={() => runEval.mutate()} disabled={runEval.isPending} className="flex-1">
          {runEval.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
          Run eval
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (confirm(`Delete "${row.title}"?`)) remove.mutate();
          }}
          disabled={remove.isPending}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </Card>
  );
}

function ResultRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
      )}
      <span className={ok ? "text-foreground" : "text-amber-700 dark:text-amber-400"}>{label}</span>
    </div>
  );
}

function GoldenEditor({
  row,
  onClose,
  onSaved,
}: {
  row: GoldenRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const upsert = useServerFn(upsertGolden);
  const [title, setTitle] = useState(row?.title ?? "");
  const [notes, setNotes] = useState(row?.notes ?? "");
  const [sourceText, setSourceText] = useState(row?.source_text ?? "");
  const [imagePath, setImagePath] = useState<string | null>(row?.image_path ?? null);
  const [tags, setTags] = useState<string[]>(row?.failure_tags ?? []);
  const [itemsJson, setItemsJson] = useState(
    JSON.stringify(row?.expected_items ?? [], null, 2),
  );
  const [clarJson, setClarJson] = useState(
    JSON.stringify(row?.expected_clarifications ?? [], null, 2),
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsedItems = useMemo(() => {
    try {
      const v = JSON.parse(itemsJson);
      return Array.isArray(v) ? (v as Record<string, unknown>[]) : null;
    } catch {
      return null;
    }
  }, [itemsJson]);

  const parsedClar = useMemo(() => {
    try {
      const v = JSON.parse(clarJson);
      return Array.isArray(v) ? (v as Record<string, unknown>[]) : null;
    } catch {
      return null;
    }
  }, [clarJson]);

  const onFile = async (file: File) => {
    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("not signed in");
      const safeName = (file.name || "upload").replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${userData.user.id}/${crypto.randomUUID()}-${safeName}`;
      const { error } = await supabase.storage
        .from("golden")
        .upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
      if (error) throw error;
      setImagePath(path);
      toast.success("Image uploaded");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const onSave = async () => {
    if (!title.trim()) {
      toast.error("Title required");
      return;
    }
    if (parsedItems === null) {
      toast.error("Expected items: invalid JSON (must be an array)");
      return;
    }
    if (parsedClar === null) {
      toast.error("Expected clarifications: invalid JSON (must be an array)");
      return;
    }
    setSaving(true);
    try {
      await upsert({
        data: {
          id: row?.id,
          title: title.trim(),
          image_path: imagePath,
          source_text: sourceText.trim() || null,
          notes: notes.trim() || null,
          expected_items: parsedItems,
          expected_clarifications: parsedClar,
          failure_tags: tags,
        },
      });
      toast.success("Saved");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row ? "Edit golden example" : "Add golden example"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Main Street Theater flyer" />
          </div>

          <div>
            <Label className="text-xs">Image</Label>
            <div className="flex items-center gap-2 mt-1">
              <label className="flex-1">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) onFile(f);
                  }}
                />
                <span className="inline-flex w-full">
                  <Button asChild variant="outline" size="sm" disabled={uploading} className="w-full">
                    <span>{uploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}{imagePath ? "Replace image" : "Upload image"}</span>
                  </Button>
                </span>
              </label>
              {imagePath && (
                <Button variant="ghost" size="sm" onClick={() => setImagePath(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {imagePath && <p className="text-[10px] text-muted-foreground mt-1 truncate">{imagePath}</p>}
          </div>

          <div>
            <Label className="text-xs">Notes (why this is tricky)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder='Document has no full date — only "Friday". Multi-task: pizza money + performance attendance + props.'
            />
          </div>

          <div>
            <Label className="text-xs">Source text (optional, used if no image)</Label>
            <Textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              rows={3}
              placeholder="Verbatim text from the document, if you have it."
            />
          </div>

          <div>
            <Label className="text-xs">
              Expected items{" "}
              {parsedItems === null ? (
                <span className="text-destructive">(invalid JSON)</span>
              ) : (
                <span className="text-muted-foreground">({parsedItems.length})</span>
              )}
            </Label>
            <Textarea
              value={itemsJson}
              onChange={(e) => setItemsJson(e.target.value)}
              rows={10}
              className="font-mono text-[11px]"
            />
          </div>

          <div>
            <Label className="text-xs">
              Expected clarifications{" "}
              {parsedClar === null ? (
                <span className="text-destructive">(invalid JSON)</span>
              ) : (
                <span className="text-muted-foreground">({parsedClar.length})</span>
              )}
            </Label>
            <Textarea
              value={clarJson}
              onChange={(e) => setClarJson(e.target.value)}
              rows={5}
              className="font-mono text-[11px]"
            />
          </div>

          <div>
            <Label className="text-xs">Failure tags</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {FAILURE_TAG_OPTIONS.map((t) => {
                const active = tags.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTags((cur) => (active ? cur.filter((x) => x !== t) : [...cur, t]))}
                    className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

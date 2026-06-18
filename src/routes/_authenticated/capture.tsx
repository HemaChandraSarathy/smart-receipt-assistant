import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Camera, Mail, Loader2, Upload } from "lucide-react";

import { PageShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { startRunFromImage, startRunFromText, scanGmailRecent, getGmailScanState } from "@/lib/agent.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/capture")({
  head: () => ({ meta: [{ title: "Capture — Inbox" }] }),
  component: CapturePage,
});

function CapturePage() {
  const qc = useQueryClient();
  const startImg = useServerFn(startRunFromImage);
  const startTxt = useServerFn(startRunFromText);
  const scan = useServerFn(scanGmailRecent);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("not signed in");
      const safeName = (file.name || "upload").replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${userData.user.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("receipts").upload(path, file, {
        upsert: false,
        contentType: file.type || "image/jpeg",
      });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage.from("receipts").createSignedUrl(path, 60 * 60);
      if (!signed?.signedUrl) throw new Error("signing failed");
      const res = await startImg({ data: { imageUrl: signed.signedUrl, storagePath: path, note: note || undefined } });
      toast.success(res.status === "awaiting_approval" ? "Ready for your approval" : "Processed");
      setNote("");
      qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const submitText = useMutation({
    mutationFn: async () => startTxt({ data: { text } }),
    onSuccess: () => {
      toast.success("Sent to the agent");
      setText("");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const scanState = useQuery({
    queryKey: ["gmail-scan-state"],
    queryFn: () => getGmailScanState(),
  });

  const gmailScan = useMutation({
    mutationFn: async () => scan({ data: undefined } as never),
    onSuccess: (r) => {
      toast.success(`Scanned ${r.scanned} email(s) — ${r.runIds.length} runs started`);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <PageShell title="Capture">
      <Card className="p-5 mb-4">
        <h2 className="font-serif text-lg mb-1">Snap or upload a photo</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Bill, coupon, invite, receipt — anything on paper. The photo is deleted right after parsing; only the extracted details are kept.
        </p>

        <label htmlFor="photo-note" className="text-sm font-medium block mb-1">
          Add context for the agent <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Textarea
          id="photo-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Soccer registration for my kid, due Friday. Pay from joint account."
          disabled={uploading}
          className="mb-3"
        />

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) handleFile(f);
              }}
            />
            <span className="inline-flex w-full">
              <Button asChild disabled={uploading} className="w-full" variant="secondary">
                <span>
                  {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Camera className="h-4 w-4 mr-2" />}
                  Take photo
                </span>
              </Button>
            </span>
          </label>

          <label className="block">
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) handleFile(f);
              }}
            />
            <span className="inline-flex w-full">
              <Button asChild disabled={uploading} className="w-full">
                <span>
                  {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                  Upload photo
                </span>
              </Button>
            </span>
          </label>
        </div>
        {uploading && <p className="text-xs text-muted-foreground mt-2">Processing…</p>}
      </Card>


      <Card className="p-5 mb-4">
        <h2 className="font-serif text-lg mb-1">Scan Gmail</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Last 30 days, common bill/coupon/invite keywords.
        </p>
        <Button onClick={() => gmailScan.mutate()} disabled={gmailScan.isPending} variant="secondary" className="w-full">
          {gmailScan.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
          Scan now
        </Button>
      </Card>

      <Card className="p-5">
        <h2 className="font-serif text-lg mb-1">Paste text</h2>
        <p className="text-sm text-muted-foreground mb-4">
          From an email, a text message, anywhere.
        </p>
        <Textarea
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the full content here…"
        />
        <Button
          onClick={() => submitText.mutate()}
          disabled={!text.trim() || submitText.isPending}
          className="w-full mt-3"
        >
          {submitText.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Send to agent
        </Button>
      </Card>
    </PageShell>
  );
}

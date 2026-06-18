// Golden-dataset server functions: CRUD + signed-url + eval harness.
//
// Goldens are stored per-user. Images live in the private "golden" bucket
// under `${userId}/${uuid}-${name}`. The eval re-runs the current extractor
// against the stored image and diffs against expected_items.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---- list ----
export const listGolden = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("golden_examples")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---- signed url for the seeded/uploaded image ----
export const getGoldenSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: signed, error } = await context.supabase.storage
      .from("golden")
      .createSignedUrl(data.path, 60 * 60);
    if (error || !signed?.signedUrl) throw new Error(error?.message ?? "no signed url");
    return { url: signed.signedUrl };
  });

// ---- upsert (create or update) ----
const UpsertInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  image_path: z.string().nullable().optional(),
  source_text: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  expected_items: z.array(z.record(z.string(), z.unknown())).default([]),
  expected_clarifications: z.array(z.record(z.string(), z.unknown())).default([]),
  failure_tags: z.array(z.string()).default([]),
});

export const upsertGolden = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpsertInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const row = {
      user_id: userId,
      title: data.title,
      image_path: data.image_path ?? null,
      source_text: data.source_text ?? null,
      notes: data.notes ?? null,
      expected_items: data.expected_items as never,
      expected_clarifications: data.expected_clarifications as never,
      failure_tags: data.failure_tags,
    };
    if (data.id) {
      const { error } = await supabase
        .from("golden_examples")
        .update(row)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await supabase
      .from("golden_examples")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id as string };
  });

// ---- delete ----
export const deleteGolden = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row } = await supabase
      .from("golden_examples")
      .select("image_path")
      .eq("id", data.id)
      .maybeSingle();
    if (row?.image_path) {
      await supabase.storage.from("golden").remove([row.image_path as string]).catch(() => {});
    }
    const { error } = await supabase.from("golden_examples").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- run eval: re-extract from the stored image and diff ----
type ExpectedItem = {
  title?: string;
  due_at?: string | null;
  date_known?: boolean;
  due_at_hint?: string | null;
  amount?: number | null;
  category?: string;
};

export const runGoldenEval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("golden_examples")
      .select("id, image_path, source_text, expected_items")
      .eq("id", data.id)
      .single();
    if (error || !row) throw new Error(error?.message ?? "not found");

    let imageUrl: string | undefined;
    if (row.image_path) {
      const { data: signed } = await supabase.storage
        .from("golden")
        .createSignedUrl(row.image_path as string, 60 * 5);
      imageUrl = signed?.signedUrl;
    }
    if (!imageUrl && !row.source_text) {
      throw new Error("golden has no image or source_text to evaluate");
    }

    const { visionExtract } = await import("@/lib/agent/tools.server");
    const started = Date.now();
    let actual: Record<string, unknown> | null = null;
    let runError: string | null = null;
    try {
      // Eval is intentionally raw — no few-shot — to measure baseline behaviour.
      actual = (await visionExtract(
        { imageUrl, text: (row.source_text as string | null) ?? undefined },
        [],
      )) as unknown as Record<string, unknown>;
    } catch (e) {
      runError = (e as Error).message;
    }
    const elapsedMs = Date.now() - started;

    const expectedItems = Array.isArray(row.expected_items) ? (row.expected_items as ExpectedItem[]) : [];
    const expectedCount = expectedItems.length;
    const actualTitle = (actual?.title as string | undefined) ?? null;
    const actualDue =
      (actual?.due_at as string | null | undefined) ??
      (actual?.expires_at as string | null | undefined) ??
      (actual?.rsvp_by as string | null | undefined) ??
      null;

    // A hallucinated date = actual returned a concrete date but ALL expected items
    // marked date_known: false (i.e. the document didn't actually have a full date).
    const expectedDateKnown = expectedItems.some((e) => e.date_known !== false && (e.due_at || e.date_known === true));
    const hallucinatedDate = !!actualDue && expectedCount > 0 && !expectedDateKnown;

    const expectedTitles = expectedItems.map((e) => (e.title ?? "").toLowerCase()).filter(Boolean);
    const actualTitleLower = (actualTitle ?? "").toLowerCase();
    const matchedAny = expectedTitles.some((t) => actualTitleLower && (t.includes(actualTitleLower.split(" ").slice(0, 3).join(" ")) || actualTitleLower.includes(t.split(" ").slice(0, 3).join(" "))));
    const missedTasks = Math.max(0, expectedCount - (actual ? 1 : 0));

    const evalResult = {
      ranAt: new Date().toISOString(),
      elapsedMs,
      error: runError,
      expectedCount,
      actualCount: actual ? 1 : 0,
      missedTasks,
      collapsedToOne: expectedCount > 1 && !!actual,
      hallucinatedDate,
      actualTitle,
      actualDue,
      matchedAnyExpectedTitle: matchedAny,
      hasRawText: !!actual?.raw_text,
      hasSourceQuote: !!actual?.source_quote,
      actual,
    };

    await supabase
      .from("golden_examples")
      .update({ last_eval: evalResult as never, last_eval_at: new Date().toISOString() })
      .eq("id", data.id);

    return evalResult;
  });

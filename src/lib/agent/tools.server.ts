// Server-only tools the agent can call. Each is a thin wrapper around a
// real provider (Lovable AI vision/embeddings, Gmail/Calendar gateway, DB).
// Tools throw on failure; the graph's retryNode catches and decides.

import { generateText } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createLovableAiGatewayProvider, embedText } from "@/lib/ai-gateway.server";
import type { ExtractedItem, AssignmentProposal, Assignee } from "./types";

export class ToolError extends Error {
  constructor(message: string, public tool: string, public retriable = true) {
    super(message);
  }
}

const GATEWAY = "https://connector-gateway.lovable.dev";

function gatewayHeaders(connectorKeyEnv: string) {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env[connectorKeyEnv];
  if (!lovableKey) throw new ToolError("LOVABLE_API_KEY missing", "gateway", false);
  if (!connKey) throw new ToolError(`${connectorKeyEnv} missing — connector not linked`, "gateway", false);
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connKey,
    "Content-Type": "application/json",
  };
}

// ---------- visionExtract: image -> ExtractedItem ----------
const nullableStr = z.unknown().optional().transform((v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
});
const nullableNum = z.unknown().optional().transform((v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^0-9.-]/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
});
const extractedSchema = z.object({
  category: z.enum(["bill", "promo", "coupon", "invite", "receipt", "other"]).catch("other"),
  category_confidence: nullableNum.transform((v) => (v == null ? 0.5 : Math.max(0, Math.min(1, v)))),
  topic: nullableStr,
  merchant: nullableStr,
  title: z.string().catch("Untitled"),
  description: nullableStr,
  amount: nullableNum,
  currency: nullableStr,
  due_at: nullableStr,
  expires_at: nullableStr,
  rsvp_by: nullableStr,
  raw_text: nullableStr,
  due_at_hint: nullableStr.optional(),
  source_quote: nullableStr.optional(),
  date_known: z.unknown().optional().transform((v) => (typeof v === "boolean" ? v : v == null ? undefined : Boolean(v))),
});

const EXTRACTOR_SYSTEM = `You are a meticulous household paper-trail assistant.
Given an image OR plain text of a piece of mail/email, extract a structured record.

HARD RULES — violating these is a failure:
1. NEVER invent a year, month, or day that is not literally printed on the document. If the document says only a weekday ("Friday") or a relative phrase ("next month"), set due_at: null AND put the literal phrase in due_at_hint, AND set date_known: false.
2. ALWAYS populate raw_text with a clean transcript of the document's main visible text (not your interpretation — the actual words).
3. ALWAYS populate source_quote with the verbatim phrase from the document that justifies the due/amount/topic you extracted.
4. category options: bill | promo | coupon | invite | receipt | other.
5. topic: short noun phrase like "HVAC promo", "medical bill", "theatre RSVP".
6. title: 3-8 word human title.
7. amount: numeric only, no currency symbol.
8. Use null when something is unknown. Do not guess.

NOTE: This extractor currently returns ONE item per document. If the document clearly contains multiple actionable tasks (e.g. "pay $5 by Thursday" AND "attend show Friday"), pick the MOST URGENT / FINANCIAL one and put the others into description so they aren't lost.

Return ONLY JSON matching the schema.`;

function buildFewShotBlock(examples: { title: string; notes: string | null; expected_items: unknown[] }[]): string {
  if (!examples.length) return "";
  const blocks = examples.slice(0, 2).map((ex, i) => {
    const first = (ex.expected_items[0] ?? {}) as Record<string, unknown>;
    return `Example ${i + 1} — ${ex.title}${ex.notes ? `\n(Why this is tricky: ${ex.notes})` : ""}\nExpected JSON for the most-urgent task:\n${JSON.stringify(first, null, 2)}`;
  });
  return `\n\nHere are reference examples from past documents (the SAME extractor previously got these wrong — follow the date discipline and raw_text/source_quote shape shown):\n\n${blocks.join("\n\n---\n\n")}`;
}

export async function visionExtract(
  input: { imageUrl?: string; text?: string },
  examples: { title: string; notes: string | null; expected_items: unknown[] }[] = [],
): Promise<ExtractedItem> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new ToolError("LOVABLE_API_KEY missing", "visionExtract", false);
  const gateway = createLovableAiGatewayProvider(key);

  const userContent: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [
    { type: "text", text: input.text ?? "Extract structured data from this document." },
  ];
  if (input.imageUrl) userContent.push({ type: "image", image: input.imageUrl });

  try {
    const { text } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      system: EXTRACTOR_SYSTEM + buildFewShotBlock(examples) + "\n\nRespond with ONLY a JSON object, no prose, no code fences.",
      messages: [{ role: "user", content: userContent }],
    });
    const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const parsed = extractedSchema.parse(JSON.parse(cleaned));
    return parsed as ExtractedItem;
  } catch (e) {
    throw new ToolError(`vision extract failed: ${(e as Error).message}`, "visionExtract");
  }
}

// ---------- assignTo: ExtractedItem -> AssignmentProposal ----------
export async function assignTo(
  item: ExtractedItem,
  rules: { owner: Assignee; keywords: string[] }[]
): Promise<AssignmentProposal> {
  const hay = `${item.title} ${item.topic ?? ""} ${item.merchant ?? ""} ${item.description ?? ""}`.toLowerCase();
  const scores: Record<Assignee, number> = { mom: 0, dad: 0, either: 0 };
  for (const r of rules) {
    for (const kw of r.keywords) {
      if (kw && hay.includes(kw.toLowerCase())) scores[r.owner] += 1;
    }
  }
  const max = Math.max(scores.mom, scores.dad);
  if (max === 0) {
    return { assignee: "either", confidence: 0.3, reasoning: "no keyword matched" };
  }
  const winner: Assignee = scores.mom >= scores.dad ? "mom" : "dad";
  const total = scores.mom + scores.dad || 1;
  return {
    assignee: winner,
    confidence: Math.min(0.95, 0.5 + (scores[winner] / total) * 0.5),
    reasoning: `matched ${scores[winner]} keyword(s) on ${winner}'s rule`,
  };
}

// ---------- Gmail ----------
export async function gmailSearch(q: string, maxResults = 20) {
  const url = `${GATEWAY}/google_mail/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: gatewayHeaders("GOOGLE_MAIL_API_KEY") });
  if (!res.ok) throw new ToolError(`gmail search ${res.status}`, "gmailSearch");
  return (await res.json()) as { messages?: { id: string; threadId: string }[] };
}

type GmailPayload = {
  headers: { name: string; value: string }[];
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
};

export async function gmailGetMessage(id: string) {
  const url = `${GATEWAY}/google_mail/gmail/v1/users/me/messages/${id}?format=full`;
  const res = await fetch(url, { headers: gatewayHeaders("GOOGLE_MAIL_API_KEY") });
  if (!res.ok) throw new ToolError(`gmail get ${res.status}`, "gmailGetMessage");
  return (await res.json()) as {
    id: string;
    snippet: string;
    payload: GmailPayload;
  };
}

// Decode base64url body and walk multipart trees to extract readable text.
export function gmailExtractBody(payload: GmailPayload): string {
  const decode = (data?: string) => {
    if (!data) return "";
    try {
      const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
      return typeof Buffer !== "undefined"
        ? Buffer.from(b64, "base64").toString("utf-8")
        : atob(b64);
    } catch {
      return "";
    }
  };
  const stripHtml = (s: string) =>
    s.replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  const walk = (p: GmailPayload, out: { plain: string[]; html: string[] }) => {
    if (p.mimeType === "text/plain" && p.body?.data) out.plain.push(decode(p.body.data));
    else if (p.mimeType === "text/html" && p.body?.data) out.html.push(stripHtml(decode(p.body.data)));
    else if (p.body?.data && !p.parts) out.plain.push(decode(p.body.data));
    for (const c of p.parts ?? []) walk(c, out);
  };
  const out = { plain: [] as string[], html: [] as string[] };
  walk(payload, out);
  const text = out.plain.join("\n").trim() || out.html.join("\n").trim();
  return text.slice(0, 8000);
}

// ---------- Calendar ----------
export async function calendarCreateEvent(input: {
  summary: string;
  description: string;
  startISO: string;
  endISO: string;
}) {
  const url = `${GATEWAY}/google_calendar/calendar/v3/calendars/primary/events`;
  const res = await fetch(url, {
    method: "POST",
    headers: gatewayHeaders("GOOGLE_CALENDAR_API_KEY"),
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.startISO },
      end: { dateTime: input.endISO },
    }),
  });
  if (!res.ok) throw new ToolError(`calendar create ${res.status} ${await res.text()}`, "calendarCreateEvent");
  return (await res.json()) as { id: string; htmlLink: string };
}

export async function calendarPatchEvent(eventId: string, patch: {
  summary?: string;
  description?: string;
  startISO?: string;
  endISO?: string;
  status?: "confirmed" | "cancelled";
}) {
  const url = `${GATEWAY}/google_calendar/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const body: Record<string, unknown> = {};
  if (patch.summary !== undefined) body.summary = patch.summary;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.startISO) body.start = { dateTime: patch.startISO };
  if (patch.endISO) body.end = { dateTime: patch.endISO };
  if (patch.status) body.status = patch.status;
  const res = await fetch(url, {
    method: "PATCH",
    headers: gatewayHeaders("GOOGLE_CALENDAR_API_KEY"),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ToolError(`calendar patch ${res.status} ${await res.text()}`, "calendarPatchEvent");
  return (await res.json()) as { id: string; htmlLink?: string };
}

export async function calendarDeleteEvent(eventId: string) {
  const url = `${GATEWAY}/google_calendar/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: gatewayHeaders("GOOGLE_CALENDAR_API_KEY"),
  });
  // 410 = already deleted; treat as success
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    throw new ToolError(`calendar delete ${res.status} ${await res.text()}`, "calendarDeleteEvent");
  }
}


// ---------- DB ----------
export async function saveItem(
  supabase: SupabaseClient,
  userId: string,
  runId: string,
  item: ExtractedItem,
  assignment: AssignmentProposal,
  source: "photo" | "gmail",
  imageUrl: string | null,
  sourceRef: Record<string, unknown>
) {
  const text = `${item.title}\n${item.topic ?? ""}\n${item.merchant ?? ""}\n${item.description ?? ""}\n${item.raw_text ?? ""}`;
  let embedding: number[] | null = null;
  try {
    embedding = await embedText(text);
  } catch {
    /* embedding optional */
  }
  const { data, error } = await supabase
    .from("items")
    .insert({
      user_id: userId,
      run_id: runId,
      category: item.category,
      topic: item.topic,
      assignee: assignment.assignee,
      merchant: item.merchant,
      title: item.title,
      description: item.description,
      amount: item.amount,
      currency: item.currency ?? "USD",
      due_at: item.due_at,
      expires_at: item.expires_at,
      rsvp_by: item.rsvp_by,
      source,
      source_ref: sourceRef,
      image_url: imageUrl,
      raw: item as unknown as Record<string, unknown>,
      embedding: embedding as unknown as null,
    })
    .select("id")
    .single();
  if (error) throw new ToolError(`saveItem: ${error.message}`, "saveItem", false);
  return data.id as string;
}

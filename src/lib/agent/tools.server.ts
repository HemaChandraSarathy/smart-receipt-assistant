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
});

const EXTRACTOR_SYSTEM = `You are a meticulous household paper-trail assistant.
Given an image OR plain text of a piece of mail/email, extract a structured record.
- category: bill | promo | coupon | invite | receipt | other
- topic: short noun phrase like "HVAC promo", "medical bill", "theatre RSVP"
- title: a 3-8 word human title
- due_at / expires_at / rsvp_by: ISO 8601 date or datetime when known
- amount: numeric only, no currency symbol
Return ONLY JSON matching the schema. Use null when unknown — do not guess.`;

export async function visionExtract(input: { imageUrl?: string; text?: string }): Promise<ExtractedItem> {
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
      system: EXTRACTOR_SYSTEM + "\n\nRespond with ONLY a JSON object, no prose, no code fences.",
      messages: [{ role: "user", content: userContent }],
    });
    const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const parsed = extractedSchema.parse(JSON.parse(cleaned));
    return parsed;
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

export async function gmailGetMessage(id: string) {
  const url = `${GATEWAY}/google_mail/gmail/v1/users/me/messages/${id}?format=full`;
  const res = await fetch(url, { headers: gatewayHeaders("GOOGLE_MAIL_API_KEY") });
  if (!res.ok) throw new ToolError(`gmail get ${res.status}`, "gmailGetMessage");
  return (await res.json()) as {
    id: string;
    snippet: string;
    payload: { headers: { name: string; value: string }[]; parts?: unknown; body?: { data?: string } };
  };
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

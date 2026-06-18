// Shared types used by both server (graph) and client (UI).
// No server-only imports here.

export type ItemCategory = "bill" | "promo" | "coupon" | "invite" | "receipt" | "other";
export type Assignee = "mom" | "dad" | "either";

export interface ExtractedItem {
  category: ItemCategory;
  category_confidence: number;
  topic: string | null;
  merchant: string | null;
  title: string;
  description: string | null;
  amount: number | null;
  currency: string | null;
  due_at: string | null;
  expires_at: string | null;
  rsvp_by: string | null;
  raw_text: string | null;
  // Set when the document only partially specifies a date (e.g. "Friday", "next month").
  // The extractor MUST NOT invent a year — set due_at: null and put the literal phrase here.
  due_at_hint?: string | null;
  // Verbatim phrase from the document that justifies the extraction.
  source_quote?: string | null;
  // False when the date had to be inferred or is unknown.
  date_known?: boolean;
}

// A golden example used to few-shot the extractor.
export interface GoldenExampleForPrompt {
  title: string;
  notes: string | null;
  expected_items: Partial<ExtractedItem>[];
}

export interface AssignmentProposal {
  assignee: Assignee;
  confidence: number;
  reasoning: string;
}

export type ApprovalProposal =
  | { kind: "save_item"; item: ExtractedItem; assignment: AssignmentProposal }
  | { kind: "create_calendar_event"; summary: string; description: string; startISO: string; endISO: string }
  | { kind: "send_reminder"; itemId: string; to: string; subject: string; body: string };

export interface AgentEvent {
  node: string;
  kind: "start" | "end" | "tool" | "error" | "interrupt" | "retry";
  payload: Record<string, unknown>;
}

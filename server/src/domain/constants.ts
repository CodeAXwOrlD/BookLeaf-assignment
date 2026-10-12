export const CATEGORIES = [
  'Royalty & Payments',
  'ISBN & Metadata Issues',
  'Printing & Quality',
  'Distribution & Availability',
  'Book Status & Production Updates',
  'General Inquiry',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'] as const;
export type Status = (typeof STATUSES)[number];

export const PRIORITY_WEIGHT: Record<Priority, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

/** Hours an unresolved ticket may sit before the queue flags it as overdue. */
export const SLA_HOURS: Record<Priority, number> = { Critical: 24, High: 48, Medium: 120, Low: 240 };

export const isActive = (s: Status) => s === 'Open' || s === 'In Progress';

export function maxPriority(a: Priority, b: Priority): Priority {
  return PRIORITY_WEIGHT[a] >= PRIORITY_WEIGHT[b] ? a : b;
}

/** Fuzzy-map whatever a small model returns ("royalty", "Royalty and Payments") onto our enum. */
export function normalizeCategory(raw: unknown): Category | null {
  if (typeof raw !== 'string') return null;
  const s = raw.toLowerCase().trim();
  const exact = CATEGORIES.find((c) => c.toLowerCase() === s);
  if (exact) return exact;
  if (/royalt|payment|payout/.test(s)) return 'Royalty & Payments';
  if (/isbn|metadata/.test(s)) return 'ISBN & Metadata Issues';
  if (/print|quality/.test(s)) return 'Printing & Quality';
  if (/distribut|availab/.test(s)) return 'Distribution & Availability';
  if (/status|production|progress/.test(s)) return 'Book Status & Production Updates';
  if (/general|inquir|other/.test(s)) return 'General Inquiry';
  return null;
}

export function normalizePriority(raw: unknown): Priority | null {
  if (typeof raw !== 'string') return null;
  const s = raw.toLowerCase().trim();
  return PRIORITIES.find((p) => p.toLowerCase() === s) ?? null;
}

/** BookLeaf production pipeline (from the knowledge base). */
export const PRODUCTION_STAGES = [
  'Manuscript Received',
  'Editing',
  'Cover Design',
  'Typesetting',
  'Proofreading',
  'ISBN Assignment',
  'Printing',
  'Distribution Setup',
  'Published & Live',
] as const;

export const ROYALTY_MIN_PAYOUT = 1000;
export const PAYOUT_WINDOW_DAYS = 45;

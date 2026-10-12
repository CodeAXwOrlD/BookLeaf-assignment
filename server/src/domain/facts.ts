import { PAYOUT_WINDOW_DAYS, PRODUCTION_STAGES, ROYALTY_MIN_PAYOUT } from './constants';

/**
 * Deterministic facts about a book. The LLM never calculates or looks anything up:
 * every number, date and status in a draft comes from here, and the model only writes the words.
 * That is the main defence against hallucinated royalty figures.
 */

export interface BookRow {
  book_id: string;
  author_id: string;
  title: string;
  isbn: string | null;
  genre: string | null;
  publication_date: string | null;
  status: string;
  mrp: number | null;
  author_royalty_per_copy: number | null;
  total_copies_sold: number;
  total_royalty_earned: number;
  royalty_paid: number;
  royalty_pending: number;
  last_royalty_payout_date: string | null;
  print_partner: string | null;
  available_on: string[];
}

// ---------- tiny UTC date helpers (YYYY-MM-DD strings, no timezone surprises) ----------
const DAY = 86_400_000;
const ms = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(ms(d) + n * DAY);
export const daysBetween = (from: string, to: string) => Math.round((ms(to) - ms(from)) / DAY);

const quarterEndsAround = (year: number) =>
  [`${year}-03-31`, `${year}-06-30`, `${year}-09-30`, `${year}-12-31`];
const allQuarterEnds = (year: number) => [
  ...quarterEndsAround(year - 1),
  ...quarterEndsAround(year),
  ...quarterEndsAround(year + 1),
];

/** Latest quarter end strictly before `d` (i.e. the most recent *completed* quarter). */
export function lastCompletedQuarterEnd(d: string): string {
  const year = Number(d.slice(0, 4));
  const candidates = allQuarterEnds(year).filter((q) => q < d);
  return candidates[candidates.length - 1];
}

/** First quarter end on or after `d`. */
export function firstQuarterEndOnOrAfter(d: string): string {
  const year = Number(d.slice(0, 4));
  return allQuarterEnds(year).find((q) => q >= d)!;
}

const nextQuarterEndAfter = (q: string) => allQuarterEnds(Number(q.slice(0, 4))).find((x) => x > q)!;

/**
 * Policy: royalties are calculated quarterly and paid within 45 days of quarter end.
 * Returns the next payout deadline relative to `asOf`.
 */
export function nextPayoutDue(asOf: string): string {
  const last = lastCompletedQuarterEnd(asOf);
  const due = addDays(last, PAYOUT_WINDOW_DAYS);
  return due >= asOf ? due : addDays(nextQuarterEndAfter(last), PAYOUT_WINDOW_DAYS);
}

// ---------- royalty status ----------
export type RoyaltyCode =
  | 'not_published'
  | 'no_sales'
  | 'settled'
  | 'below_threshold'
  | 'first_payout_due'
  | 'never_paid_overdue'
  | 'in_cycle'
  | 'stale_since_last_payout';

/** One quarter (90d) + 45d payout window. Beyond this since the last payout, something may have been missed. */
const CYCLE_DAYS = 90 + PAYOUT_WINDOW_DAYS;

export const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-11-14' -> '14 Nov 2026' (how people actually write dates in replies). */
export const fmtDate = (d: string | null | undefined) => {
  if (!d) return 'n/a';
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
};

export interface BookFacts {
  bookId: string;
  title: string;
  isbn: string | null;
  genre: string | null;
  status: string;
  isPublished: boolean;
  production: { stage: string; position: number; total: number; remaining: string[] } | null;
  publicationDate: string | null;
  mrp: number | null;
  royaltyPerCopy: number | null;
  copiesSold: number;
  earned: number;
  paid: number;
  pending: number;
  lastPayoutDate: string | null;
  platforms: string[];
  printPartner: string | null;
  royalty: { code: RoyaltyCode; note: string; daysOverdue?: number; dueBy?: string };
  nextPayoutDue: string;
}

export function parseProduction(status: string): BookFacts['production'] {
  const m = /^In Production\s*-\s*(.+)$/i.exec(status);
  if (!m) return null;
  const stage = m[1].trim();
  const idx = PRODUCTION_STAGES.findIndex((s) => s.toLowerCase() === stage.toLowerCase());
  return {
    stage,
    position: idx >= 0 ? idx + 1 : 0,
    total: PRODUCTION_STAGES.length,
    remaining: idx >= 0 ? PRODUCTION_STAGES.slice(idx + 1).map(String) : [],
  };
}

export function royaltyStatus(b: BookRow, asOf: string): BookFacts['royalty'] {
  const next = nextPayoutDue(asOf);
  const isPublished = /^Published/i.test(b.status);
  if (!isPublished) {
    return { code: 'not_published', note: 'Not yet published, so no sales or royalties exist for this book.' };
  }
  if (b.total_copies_sold === 0) {
    return { code: 'no_sales', note: 'Published but no copies sold yet, so no royalty has been earned.' };
  }
  if (b.royalty_pending === 0) {
    return { code: 'settled', note: `All earned royalties (${inr(b.total_royalty_earned)}) have been paid.` };
  }
  if (b.royalty_pending < ROYALTY_MIN_PAYOUT) {
    return {
      code: 'below_threshold',
      note: `Pending ${inr(b.royalty_pending)} is below the ${inr(ROYALTY_MIN_PAYOUT)} minimum payout threshold, so it rolls over to the next quarter. This is NOT a late payment.`,
    };
  }
  if (!b.last_royalty_payout_date) {
    const firstQuarterEnd = firstQuarterEndOnOrAfter(b.publication_date ?? asOf);
    const dueBy = addDays(firstQuarterEnd, PAYOUT_WINDOW_DAYS);
    if (asOf > dueBy) {
      const daysOverdue = daysBetween(dueBy, asOf);
      return {
        code: 'never_paid_overdue',
        daysOverdue,
        dueBy,
        note: `No payout recorded since publication on ${fmtDate(b.publication_date)}. The first payout was due by ${fmtDate(dueBy)}, ${daysOverdue} days ago, with ${inr(b.royalty_pending)} pending. This is overdue on BookLeaf's side: own it and escalate.`,
      };
    }
    return {
      code: 'first_payout_due',
      dueBy,
      note: `No payout yet. The first payout of ${inr(b.royalty_pending)} is due by ${fmtDate(dueBy)} (quarter end + 45 days).`,
    };
  }
  const since = daysBetween(b.last_royalty_payout_date, asOf);
  if (since > CYCLE_DAYS) {
    return {
      code: 'stale_since_last_payout',
      daysOverdue: since - CYCLE_DAYS,
      note: `${inr(b.royalty_pending)} pending. The last payout was on ${fmtDate(b.last_royalty_payout_date)} (${since} days ago), longer than one quarterly cycle. A payout may have been missed: flag for verification and give a 48-hour timeline.`,
    };
  }
  return {
    code: 'in_cycle',
    dueBy: next,
    note: `${inr(b.royalty_pending)} pending. Last payout was on ${fmtDate(b.last_royalty_payout_date)}. Next payout is due by ${fmtDate(next)}.`,
  };
}

export function buildBookFacts(b: BookRow, asOf: string): BookFacts {
  return {
    bookId: b.book_id,
    title: b.title,
    isbn: b.isbn,
    genre: b.genre,
    status: b.status,
    isPublished: /^Published/i.test(b.status),
    production: parseProduction(b.status),
    publicationDate: b.publication_date,
    mrp: b.mrp,
    royaltyPerCopy: b.author_royalty_per_copy,
    copiesSold: b.total_copies_sold,
    earned: b.total_royalty_earned,
    paid: b.royalty_paid,
    pending: b.royalty_pending,
    lastPayoutDate: b.last_royalty_payout_date,
    platforms: b.available_on ?? [],
    printPartner: b.print_partner,
    royalty: royaltyStatus(b, asOf),
    nextPayoutDue: nextPayoutDue(asOf),
  };
}

/** Compact text block for prompts. Full detail for one book, one line per book otherwise. */
export function factsToPrompt(books: BookFacts[], focusBookId: string | null, asOf: string): string {
  const lines: string[] = [`Today: ${fmtDate(asOf)}`, `Next quarterly payout deadline: ${fmtDate(nextPayoutDue(asOf))}`];
  const focus = focusBookId ? books.find((b) => b.bookId === focusBookId) : undefined;
  if (focus) {
    lines.push(`Book in question: "${focus.title}" (${focus.bookId})`);
    lines.push(`- Status: ${focus.status}`);
    if (focus.production) {
      lines.push(
        `- Production: stage ${focus.production.position || '?'} of ${focus.production.total} (${focus.production.stage}). Remaining after this: ${focus.production.remaining.join(', ') || 'n/a'}. No stage start dates are recorded; do not invent one.`,
      );
    }
    if (focus.isPublished) {
      lines.push(`- ISBN on record: ${focus.isbn}; MRP: ${focus.mrp !== null ? inr(focus.mrp) : 'n/a'}; published ${fmtDate(focus.publicationDate)}`);
      lines.push(`- Listed on: ${focus.platforms.join(', ') || 'none recorded'}; printed by: ${focus.printPartner ?? 'n/a'}`);
      lines.push(
        `- Sales: ${focus.copiesSold} copies; royalty earned ${inr(focus.earned)}, paid ${inr(focus.paid)}, pending ${inr(focus.pending)}${focus.royaltyPerCopy ? ` (record shows ${inr(focus.royaltyPerCopy)} per copy)` : ''}`,
      );
      lines.push(`- Royalty position: ${focus.royalty.note}`);
    } else {
      lines.push(`- ISBN on record: ${focus.isbn ?? 'not yet assigned'}`);
    }
  } else {
    lines.push('No specific book selected. Author\'s books:');
    for (const b of books) {
      lines.push(
        `- "${b.title}" (${b.bookId}): ${b.status}${b.isPublished ? `; sold ${b.copiesSold}; pending ${inr(b.pending)}` : ''}`,
      );
    }
  }
  lines.push('Bank details status: not visible in this system. Never claim they are or are not linked; ask the author to confirm in their dashboard.');
  return lines.join('\n');
}

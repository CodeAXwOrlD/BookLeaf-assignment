export type Role = 'author' | 'admin';
export interface User { id: number; role: Role; authorId: string | null; name: string; email: string }

export const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'] as const;
export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export const CATEGORIES = [
  'Royalty & Payments', 'ISBN & Metadata Issues', 'Printing & Quality',
  'Distribution & Availability', 'Book Status & Production Updates', 'General Inquiry',
] as const;
export const PRODUCTION_STAGES = [
  'Manuscript Received', 'Editing', 'Cover Design', 'Typesetting', 'Proofreading',
  'ISBN Assignment', 'Printing', 'Distribution Setup', 'Published & Live',
] as const;
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Category = (typeof CATEGORIES)[number];

export type RoyaltyCode =
  | 'not_published' | 'no_sales' | 'settled' | 'below_threshold' | 'first_payout_due'
  | 'never_paid_overdue' | 'in_cycle' | 'stale_since_last_payout';

export interface Book {
  bookId: string; title: string; isbn: string | null; genre: string | null; status: string; isPublished: boolean;
  production: { stage: string; position: number; total: number; remaining: string[] } | null;
  publicationDate: string | null; mrp: number | null; royaltyPerCopy: number | null; copiesSold: number;
  royaltyEarned: number; royaltyPaid: number; royaltyPending: number; lastPayoutDate: string | null;
  platforms: string[]; printPartner: string | null;
  royaltyStatus: { code: RoyaltyCode; note: string; daysOverdue?: number; dueBy?: string };
  nextPayoutDue: string;
}

export interface Message {
  id: number; role: 'author' | 'admin'; senderName: string; body: string;
  internal?: boolean; aiDraftUsed?: boolean; createdAt: string;
}

export interface AuthorTicketSummary {
  id: number; subject: string; status: Status; category: Category; bookId: string | null; bookTitle: string | null;
  createdAt: string; updatedAt: string; replyCount: number; lastReplyAt: string | null;
  /** Server-side: true when there is an admin reply the author hasn't seen yet. */
  unread: boolean;
}
export interface AuthorTicketDetail extends AuthorTicketSummary {
  description: string; attachments: { name: string; size?: number }[]; messages: Message[];
}

export interface AdminTicketSummary {
  id: number; subject: string; status: Status; category: Category; priority: Priority;
  aiCategory: Category | null; aiPriority: Priority | null; aiStatus: 'pending' | 'llm' | 'rules';
  categoryOverridden: boolean; priorityOverridden: boolean;
  authorId: string; authorName: string; bookTitle: string | null;
  assigneeId: number | null; assigneeName: string | null;
  createdAt: string; updatedAt: string; ageHours: number; overdue: boolean; awaitingReply: boolean;
}
export interface TicketEvent { id: number; type: string; detail: any; actorName: string | null; createdAt: string }
export interface BookFacts {
  bookId: string; title: string; status: string; isPublished: boolean; copiesSold: number;
  earned: number; paid: number; pending: number; lastPayoutDate: string | null; nextPayoutDue: string;
  royalty: { code: RoyaltyCode; note: string };
  production: { stage: string; position: number; total: number } | null;
  platforms: string[];
}
export interface AdminTicketDetail extends AdminTicketSummary {
  description: string; attachments: { name: string; size?: number }[]; bookId: string | null;
  aiReasoning: string | null; messages: Message[]; events: TicketEvent[];
  resolvedAt: string | null;
}
export interface Draft {
  body: string; source: 'llm' | 'template'; provider: string | null; model: string | null;
  generatedAt: string; fallbackReason?: string; cached: boolean;
}
export interface Stats {
  tickets: { open: number; inProgress: number; critical: number; unassigned: number; overdue: number };
  ai: {
    providersConfigured: string[]; triagePending: number; categoryOverrideRate: number; priorityOverrideRate: number;
    last24h: { calls: number; promptTokens: number; completionTokens: number; failures: number };
  };
}
export interface DemoAccounts {
  enabled: boolean; authorPassword?: string; adminPassword?: string;
  accounts: { email: string; name: string; role: Role }[];
}

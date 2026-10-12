import { SLA_HOURS, isActive, type Priority, type Status } from '../domain/constants';
import { buildBookFacts, type BookRow } from '../domain/facts';

const iso = (d: string | Date | null) => (d ? new Date(d).toISOString() : null);

export function bookDto(row: BookRow, asOf: string) {
  const f = buildBookFacts(row, asOf);
  return {
    bookId: f.bookId,
    title: f.title,
    isbn: f.isbn,
    genre: f.genre,
    status: f.status,
    isPublished: f.isPublished,
    production: f.production,
    publicationDate: f.publicationDate,
    mrp: f.mrp,
    royaltyPerCopy: f.royaltyPerCopy,
    copiesSold: f.copiesSold,
    royaltyEarned: f.earned,
    royaltyPaid: f.paid,
    royaltyPending: f.pending,
    lastPayoutDate: f.lastPayoutDate,
    platforms: f.platforms,
    printPartner: f.printPartner,
    royaltyStatus: f.royalty,
    nextPayoutDue: f.nextPayoutDue,
  };
}

export function authorTicketSummary(r: any) {
  const lastAdminReply = r.last_admin_reply_at ? new Date(r.last_admin_reply_at).getTime() : 0;
  const lastRead = r.last_read_at ? new Date(r.last_read_at).getTime() : 0;
  return {
    id: r.id,
    subject: r.subject,
    status: r.status as Status,
    category: r.category,
    bookId: r.book_id,
    bookTitle: r.book_title ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    replyCount: r.admin_replies ?? 0,
    lastReplyAt: iso(r.last_admin_reply_at ?? null),
    // Server-side unread: there's an admin reply newer than the author's last read
    unread: lastAdminReply > 0 && lastAdminReply > lastRead,
  };
}

export function adminTicketSummary(r: any, now = Date.now()) {
  const ageHours = (now - new Date(r.created_at).getTime()) / 3_600_000;
  const priority = r.priority as Priority;
  return {
    id: r.id,
    subject: r.subject,
    status: r.status as Status,
    category: r.category,
    priority,
    aiCategory: r.ai_category,
    aiPriority: r.ai_priority,
    aiStatus: r.ai_status,
    categoryOverridden: r.category_overridden,
    priorityOverridden: r.priority_overridden,
    authorId: r.author_id,
    authorName: r.author_name,
    bookTitle: r.book_title ?? null,
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_name ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    ageHours: Math.round(ageHours * 10) / 10,
    overdue: isActive(r.status) && ageHours > SLA_HOURS[priority],
    awaitingReply: isActive(r.status) && r.last_role !== 'admin',
  };
}

export function messageDto(m: any) {
  return {
    id: m.id,
    role: m.sender_role as 'author' | 'admin',
    senderName: m.sender_name,
    body: m.body,
    internal: m.is_internal,
    aiDraftUsed: m.ai_draft_used,
    createdAt: iso(m.created_at),
  };
}

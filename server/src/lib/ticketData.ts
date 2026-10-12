import type { Queryable } from '../db';
import { buildBookFacts, type BookFacts, type BookRow } from '../domain/facts';

export interface TicketRow {
  id: number;
  author_id: string;
  book_id: string | null;
  subject: string;
  description: string;
  attachments: { name: string; size?: number; type?: string }[];
  status: 'Open' | 'In Progress' | 'Resolved' | 'Closed';
  category: string;
  priority: string;
  ai_category: string | null;
  ai_priority: string | null;
  ai_reasoning: string | null;
  ai_status: 'pending' | 'llm' | 'rules';
  category_overridden: boolean;
  priority_overridden: boolean;
  assignee_id: number | null;
  created_at: string | Date;
  updated_at: string | Date;
  resolved_at: string | Date | null;
}

export async function getTicket(q: Queryable, id: number): Promise<TicketRow | null> {
  const rows = await q.query<TicketRow>('SELECT * FROM tickets WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function getAuthorBooks(q: Queryable, authorId: string): Promise<BookRow[]> {
  return q.query<BookRow>('SELECT * FROM books WHERE author_id = $1 ORDER BY book_id', [authorId]);
}

export async function getAuthor(q: Queryable, authorId: string) {
  const rows = await q.query<{ author_id: string; name: string; email: string; city: string | null }>(
    'SELECT author_id, name, email, city FROM authors WHERE author_id = $1',
    [authorId],
  );
  return rows[0] ?? null;
}

export interface TicketContext {
  ticket: TicketRow;
  authorName: string;
  firstName: string;
  facts: BookFacts[];
  focus: BookFacts | undefined;
}

/** Loads a ticket plus the deterministic facts the AI (and the admin sidebar) rely on. */
export async function loadTicketContext(q: Queryable, ticketId: number, asOf: string): Promise<TicketContext | null> {
  const ticket = await getTicket(q, ticketId);
  if (!ticket) return null;
  const [author, books] = await Promise.all([getAuthor(q, ticket.author_id), getAuthorBooks(q, ticket.author_id)]);
  const facts = books.map((b) => buildBookFacts(b, asOf));
  const authorName = author?.name ?? 'Author';
  return {
    ticket,
    authorName,
    firstName: authorName.split(' ')[0],
    facts,
    focus: ticket.book_id ? facts.find((f) => f.bookId === ticket.book_id) : undefined,
  };
}

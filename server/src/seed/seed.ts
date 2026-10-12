import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import type { Ctx } from '../context';

const DATA_FILE = resolve(import.meta.dirname, '../../data/bookleaf_sample_data.json');

interface SeedBook {
  book_id: string; title: string; isbn: string; genre: string; publication_date: string | null; status: string;
  mrp: number | null; author_royalty_per_copy: number | null; total_copies_sold: number; total_royalty_earned: number;
  royalty_paid: number; royalty_pending: number; last_royalty_payout_date: string | null; print_partner: string | null;
  available_on: string[];
}
interface SeedAuthor {
  author_id: string; name: string; email: string; phone: string; city: string; joined_date: string; books: SeedBook[];
}

const ADMINS = [
  { email: 'admin@bookleaf.in', name: 'Aarav Menon' },
  { email: 'ops@bookleaf.in', name: 'Ishita Rao' },
];

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/** Hand-written demo tickets so both portals have something to show on first load, with or without an API key. */
const DEMO_TICKETS = [
  { author: 'AUTH003', book: 'BK005', hours: 70, status: 'Open', cat: 'Royalty & Payments', pri: 'High', assignee: null,
    subject: 'No royalty received since my book went live',
    body: 'Between Two Temples has been live since July 2024 and I have not received a single payment. Can you tell me what is going on?',
    thread: [] as [string, string, boolean?][] },
  { author: 'AUTH006', book: 'BK010', hours: 30, status: 'In Progress', cat: 'Royalty & Payments', pri: 'Medium', assignee: 0,
    subject: 'Royalty amount seems too low',
    body: 'I sold close to 90 copies of Turban Tales but my royalty looks very small. How is it calculated?',
    thread: [['admin', 'Hi Arjun, thanks for asking. I am pulling the platform-wise breakdown for Turban Tales and will send it across today.'],
             ['admin', 'Checked with finance: no payout has gone out for this title yet. Flag as overdue.', true]] },
  { author: 'AUTH001', book: 'BK001', hours: 20, status: 'Open', cat: 'ISBN & Metadata Issues', pri: 'High', assignee: null,
    subject: 'Different ISBN on Amazon than on the printed copy',
    body: 'The ISBN shown on the Amazon page for Whispers of the Ganges does not match the one printed on my copy.', thread: [] },
  { author: 'AUTH002', book: 'BK003', hours: 200, status: 'Resolved', cat: 'Printing & Quality', pri: 'Medium', assignee: 1,
    subject: 'Blurry images in my author copies',
    body: 'The images in Code & Karma are blurry and a few pages are misaligned in the copies I received.',
    thread: [['admin', 'Hi Rohit, I am sorry about that. Please send a few photos of the affected pages and we will arrange a free reprint once verified.'],
             ['author', 'Photos attached in the email I just sent. Pages 42 to 55 are the worst.'],
             ['admin', 'Thank you. Verified. The reprint is booked and will reach you in 5-7 business days.']] },
  { author: 'AUTH007', book: 'BK013', hours: 52, status: 'Open', cat: 'Book Status & Production Updates', pri: 'Medium', assignee: null,
    subject: 'When will Midnight in Mysore be ready?',
    body: 'My thriller has been at cover design for a few weeks now. Can you tell me what the next steps are and when to expect it?', thread: [] },
  { author: 'AUTH009', book: 'BK016', hours: 8, status: 'Open', cat: 'Royalty & Payments', pri: 'Medium', assignee: null,
    subject: 'Why have I not been paid for The Nagpur Notebooks?',
    body: 'My book has been out since November 2024 and nothing has arrived in my account yet.', thread: [] },
  { author: 'AUTH010', book: 'BK018', hours: 5, status: 'Open', cat: 'Distribution & Availability', pri: 'Low', assignee: null,
    subject: 'Can Howrah Nights be listed on Flipkart?',
    body: 'My other book is on Flipkart but Howrah Nights only shows on Amazon India. Could it be added to Flipkart too?', thread: [] },
  { author: 'AUTH004', book: null, hours: 400, status: 'Closed', cat: 'General Inquiry', pri: 'Low', assignee: 0,
    subject: 'Updating my author bio',
    body: 'Can I update the author bio on my book pages? I have a new short bio.',
    thread: [['admin', 'Hi Vikram, yes: send the new bio through your dashboard or email us. It reflects on platforms within 3-5 business days.']] },
] as const;

export async function seedDatabase(ctx: Ctx) {
  const { db, config } = ctx;
  const authors: SeedAuthor[] = JSON.parse(readFileSync(DATA_FILE, 'utf8')).authors;
  const authorHash = bcrypt.hashSync(config.seedAuthorPassword, 10);
  const adminHash = bcrypt.hashSync(config.seedAdminPassword, 10);

  await db.tx(async (q) => {
    for (const a of authors) {
      await q.query(
        'INSERT INTO authors (author_id, name, email, phone, city, joined_date) VALUES ($1,$2,$3,$4,$5,$6)',
        [a.author_id, a.name, a.email, a.phone, a.city, a.joined_date],
      );
      await q.query('INSERT INTO users (email, password_hash, name, role, author_id) VALUES ($1,$2,$3,$4,$5)', [
        a.email.toLowerCase(), authorHash, a.name, 'author', a.author_id,
      ]);
      for (const b of a.books) {
        await q.query(
          `INSERT INTO books (book_id, author_id, title, isbn, genre, publication_date, status, mrp, author_royalty_per_copy,
             total_copies_sold, total_royalty_earned, royalty_paid, royalty_pending, last_royalty_payout_date, print_partner, available_on)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [b.book_id, a.author_id, b.title, b.isbn, b.genre, b.publication_date, b.status, b.mrp, b.author_royalty_per_copy,
           b.total_copies_sold, b.total_royalty_earned, b.royalty_paid, b.royalty_pending, b.last_royalty_payout_date,
           b.print_partner, JSON.stringify(b.available_on)],
        );
      }
    }
    const adminIds: number[] = [];
    for (const ad of ADMINS) {
      const [u] = await q.query<{ id: number }>(
        `INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,'admin') RETURNING id`,
        [ad.email, adminHash, ad.name],
      );
      adminIds.push(u.id);
    }

    for (const t of DEMO_TICKETS) {
      const [u] = await q.query<{ id: number }>('SELECT id FROM users WHERE author_id = $1', [t.author]);
      const assignee = t.assignee === null ? null : adminIds[t.assignee];
      const created = hoursAgo(t.hours);
      const resolved = t.status === 'Resolved' || t.status === 'Closed' ? hoursAgo(Math.max(t.hours - 24, 1)) : null;
      const [row] = await q.query<{ id: number }>(
        `INSERT INTO tickets (author_id, book_id, subject, description, status, category, priority, ai_status,
           assignee_id, created_at, updated_at, resolved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$9,$10) RETURNING id`,
        [t.author, t.book, t.subject, t.body, t.status, t.cat, t.pri, assignee, created, resolved],
      );
      await q.query(`INSERT INTO ticket_events (ticket_id, actor_id, type, created_at) VALUES ($1,$2,'created',$3)`, [row.id, u.id, created]);
      let n = 1;
      for (const [role, body, internal] of t.thread) {
        const sender = role === 'author' ? u.id : (assignee ?? adminIds[0]);
        await q.query(
          `INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, body, is_internal, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
          [row.id, sender, role, body, !!internal, hoursAgo(Math.max(t.hours - n * 3, 1))],
        );
        n++;
      }
    }
  });
}

export async function seedIfEmpty(ctx: Ctx) {
  const [{ n }] = await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM authors');
  if (n === 0) {
    await seedDatabase(ctx);
    ctx.log.info({}, 'database seeded with 10 authors, 18 books and demo tickets');
  }
}

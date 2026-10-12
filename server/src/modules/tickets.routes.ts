import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { queueTriage } from '../ai/triage';
import type { Ctx } from '../context';
import { badRequest, conflict, notFound } from '../errors';
import { authorTicketSummary, messageDto } from './dto';

const idParam = z.object({ id: z.coerce.number().int().positive() });

const createSchema = z.object({
  bookId: z.string().max(20).nullish(),
  subject: z.string().trim().min(3, 'Subject must be at least 3 characters').max(140),
  description: z.string().trim().min(10, 'Please describe your query in at least 10 characters').max(5000),
  // File upload is UI-only for now: we persist file metadata, not bytes (see README, limitations).
  attachments: z
    .array(z.object({ name: z.string().max(200), size: z.number().int().nonnegative().optional(), type: z.string().max(100).optional() }))
    .max(5)
    .default([]),
});

const replySchema = z.object({ body: z.string().trim().min(1, 'Message cannot be empty').max(5000) });

const LIST_SQL = `
  SELECT t.*, b.title AS book_title,
    (SELECT count(*)::int FROM ticket_messages m WHERE m.ticket_id = t.id AND m.is_internal = FALSE AND m.sender_role = 'admin') AS admin_replies,
    (SELECT max(m.created_at) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.is_internal = FALSE AND m.sender_role = 'admin') AS last_admin_reply_at,
    r.read_at AS last_read_at
  FROM tickets t LEFT JOIN books b ON b.book_id = t.book_id
  LEFT JOIN ticket_reads r ON r.ticket_id = t.id AND r.user_id = $USER_ID`;

/** Author-facing ticket API. Every query is scoped by the author id from the signed token. */
export async function ticketRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post(
    '/tickets',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 hour',
          keyGenerator: (req) => String(req.user?.id ?? req.ip),
        },
      },
    },
    async (req, reply) => {
    const body = createSchema.parse(req.body);
    const authorId = req.user!.authorId!;

    if (body.bookId) {
      const [book] = await ctx.db.query('SELECT 1 FROM books WHERE book_id = $1 AND author_id = $2', [body.bookId, authorId]);
      if (!book) throw badRequest('That book is not on your account', { field: 'bookId' });
    }

    const [row] = await ctx.db.query<{ id: number }>(
      `INSERT INTO tickets (author_id, book_id, subject, description, attachments)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [authorId, body.bookId ?? null, body.subject, body.description, JSON.stringify(body.attachments)],
    );
    await ctx.db.query(`INSERT INTO ticket_events (ticket_id, actor_id, type) VALUES ($1,$2,'created')`, [row.id, req.user!.id]);

    ctx.hub.publish({ type: 'ticket.created', ticketId: row.id, authorId });
    queueTriage(ctx, row.id); // AI classification runs after the response; ticket creation never depends on it.

    const [created] = await ctx.db.query(`${LIST_SQL.replace('$USER_ID', String(req.user!.id))} WHERE t.id = $1`, [row.id]);
    return reply.code(201).send({ ticket: authorTicketSummary(created) });
  });

  app.get('/tickets', async (req) => {
    const userId = req.user!.id;
    const sql = LIST_SQL.replace('$USER_ID', String(userId));
    const rows = await ctx.db.query(`${sql} WHERE t.author_id = $1 ORDER BY t.updated_at DESC`, [req.user!.authorId]);
    return { tickets: rows.map(authorTicketSummary) };
  });

  app.get('/tickets/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const userId = req.user!.id;
    const sql = LIST_SQL.replace('$USER_ID', String(userId));
    // 404 (not 403) for other authors' tickets so ids can't be probed.
    const [t] = await ctx.db.query(`${sql} WHERE t.id = $1 AND t.author_id = $2`, [id, req.user!.authorId]);
    if (!t) throw notFound('Ticket');
    // is_internal = FALSE is enforced in SQL: internal notes can never reach this response.
    const messages = await ctx.db.query(
      `SELECT m.*, u.name AS sender_name FROM ticket_messages m JOIN users u ON u.id = m.sender_id
       WHERE m.ticket_id = $1 AND m.is_internal = FALSE ORDER BY m.id`,
      [id],
    );
    // Record that this author has now read this ticket (upsert; cheap idempotent write).
    ctx.db.query(
      `INSERT INTO ticket_reads (ticket_id, user_id, read_at) VALUES ($1, $2, now())
       ON CONFLICT (ticket_id, user_id) DO UPDATE SET read_at = now()`,
      [id, userId],
    ).catch(() => {/* non-critical */});
    return {
      ticket: {
        ...authorTicketSummary(t),
        description: t.description,
        attachments: t.attachments,
        messages: messages.map(messageDto).map(({ internal: _i, aiDraftUsed: _a, ...m }) => m),
      },
    };
  });

  app.post('/tickets/:id/messages', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { body } = replySchema.parse(req.body);
    const [t] = await ctx.db.query<{ status: string; author_id: string }>(
      'SELECT status, author_id FROM tickets WHERE id = $1 AND author_id = $2',
      [id, req.user!.authorId],
    );
    if (!t) throw notFound('Ticket');
    if (t.status === 'Closed') throw conflict('TICKET_CLOSED', 'This ticket is closed. Please open a new query.');

    await ctx.db.tx(async (q) => {
      await q.query(`INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, body) VALUES ($1,$2,'author',$3)`, [id, req.user!.id, body]);
      // An author reply on a resolved ticket reopens it so it comes back into the queue.
      if (t.status === 'Resolved') {
        await q.query(`UPDATE tickets SET status = 'Open', resolved_at = NULL, updated_at = now() WHERE id = $1`, [id]);
        await q.query(`INSERT INTO ticket_events (ticket_id, actor_id, type, detail) VALUES ($1,$2,'reopened',$3)`, [id, req.user!.id, JSON.stringify({ from: 'Resolved', to: 'Open' })]);
      } else {
        await q.query('UPDATE tickets SET updated_at = now() WHERE id = $1', [id]);
      }
    });
    ctx.hub.publish({ type: 'message.created', ticketId: id, authorId: t.author_id });
    return reply.code(201).send({ ok: true });
  });
}

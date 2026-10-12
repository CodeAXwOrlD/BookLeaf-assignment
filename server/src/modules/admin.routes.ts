import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDraft } from '../ai/drafter';
import { queueTriage } from '../ai/triage';
import type { Ctx } from '../context';
import { CATEGORIES, PRIORITIES, STATUSES, isActive } from '../domain/constants';
import { conflict, notFound } from '../errors';
import { getTicket, loadTicketContext } from '../lib/ticketData';
import { adminTicketSummary, messageDto } from './dto';

const idParam = z.object({ id: z.coerce.number().int().positive() });

const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v), z.array(item).optional());

const listQuery = z.object({
  status: csv(z.enum(STATUSES)),
  category: csv(z.enum(CATEGORIES)),
  priority: csv(z.enum(PRIORITIES)),
  assignee: z.union([z.literal('me'), z.literal('unassigned'), z.coerce.number().int().positive()]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['urgency', 'newest', 'oldest']).default('urgency'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const patchSchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    category: z.enum(CATEGORIES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assignee: z.union([z.literal('me'), z.null(), z.coerce.number().int().positive()]).optional(),
  })
  .refine((o) => Object.values(o).some((v) => v !== undefined), { message: 'Provide at least one field to update' });

const noteSchema = z.object({ body: z.string().trim().min(1).max(5000) });
const replySchema = z.object({
  body: z.string().trim().min(1, 'Reply cannot be empty').max(5000),
  usedDraft: z.boolean().default(false),
  status: z.enum(['In Progress', 'Resolved', 'Closed']).optional(),
});
const draftSchema = z.object({ instruction: z.string().trim().max(300).optional() });

const SLA_SQL = `(CASE t.priority WHEN 'Critical' THEN 24 WHEN 'High' THEN 48 WHEN 'Medium' THEN 120 ELSE 240 END)`;

const SUMMARY_SQL = `
  SELECT t.*, a.name AS author_name, b.title AS book_title, u.name AS assignee_name,
    (SELECT m.sender_role FROM ticket_messages m WHERE m.ticket_id = t.id AND m.is_internal = FALSE ORDER BY m.id DESC LIMIT 1) AS last_role
  FROM tickets t
  JOIN authors a ON a.author_id = t.author_id
  LEFT JOIN books b ON b.book_id = t.book_id
  LEFT JOIN users u ON u.id = t.assignee_id`;

/** Admin API. The whole plugin is mounted behind requireRole('admin'). */
export async function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  // ------------------------------------------------------------------ queue
  app.get('/admin/tickets', async (req) => {
    const f = listQuery.parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const inList = (col: string, vals: readonly string[] | undefined) => {
      if (vals?.length) where.push(`${col} IN (${vals.map(p).join(',')})`);
    };
    inList('t.status', f.status);
    inList('t.category', f.category);
    inList('t.priority', f.priority);
    if (f.assignee === 'me') where.push(`t.assignee_id = ${p(req.user!.id)}`);
    else if (f.assignee === 'unassigned') where.push('t.assignee_id IS NULL');
    else if (typeof f.assignee === 'number') where.push(`t.assignee_id = ${p(f.assignee)}`);
    if (f.from) where.push(`t.created_at >= ${p(f.from)}::date`);
    if (f.to) where.push(`t.created_at < (${p(f.to)}::date + 1)`);
    if (f.q) {
      const like = p(`%${f.q}%`);
      const asId = Number(f.q.replace(/^#|^t-/i, ''));
      const idClause = Number.isInteger(asId) && asId > 0 ? ` OR t.id = ${p(asId)}` : '';
      where.push(`(t.subject ILIKE ${like} OR a.name ILIKE ${like} OR b.title ILIKE ${like}${idClause})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const order =
      f.sort === 'newest'
        ? 't.created_at DESC'
        : f.sort === 'oldest'
          ? 't.created_at ASC'
          : // urgency: unresolved first, then priority, then oldest first
            `CASE WHEN t.status IN ('Open','In Progress') THEN 0 ELSE 1 END,
             CASE t.priority WHEN 'Critical' THEN 4 WHEN 'High' THEN 3 WHEN 'Medium' THEN 2 ELSE 1 END DESC,
             t.created_at ASC`;

    const countRows = await ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tickets t JOIN authors a ON a.author_id = t.author_id LEFT JOIN books b ON b.book_id = t.book_id ${whereSql}`,
      params,
    );
    const rows = await ctx.db.query(
      `${SUMMARY_SQL} ${whereSql} ORDER BY ${order} LIMIT ${p(f.pageSize)} OFFSET ${p((f.page - 1) * f.pageSize)}`,
      params,
    );
    const now = Date.now();
    return { total: countRows[0].n, page: f.page, pageSize: f.pageSize, tickets: rows.map((r) => adminTicketSummary(r, now)) };
  });

  app.get('/admin/stats', async () => {
    const [counts] = await ctx.db.query(
      `SELECT
         count(*) FILTER (WHERE t.status = 'Open')::int AS open,
         count(*) FILTER (WHERE t.status = 'In Progress')::int AS in_progress,
         count(*) FILTER (WHERE t.status IN ('Open','In Progress') AND t.priority = 'Critical')::int AS critical,
         count(*) FILTER (WHERE t.status IN ('Open','In Progress') AND t.assignee_id IS NULL)::int AS unassigned,
         count(*) FILTER (WHERE t.status IN ('Open','In Progress') AND t.created_at < now() - ${SLA_SQL} * interval '1 hour')::int AS overdue,
         count(*) FILTER (WHERE t.ai_status = 'pending')::int AS triage_pending,
         count(*) FILTER (WHERE t.ai_status <> 'pending')::int AS triaged,
         count(*) FILTER (WHERE t.category_overridden)::int AS category_overrides,
         count(*) FILTER (WHERE t.priority_overridden)::int AS priority_overrides
       FROM tickets t`,
    );
    const [usage] = await ctx.db.query(
      `SELECT count(*)::int AS calls, coalesce(sum(prompt_tokens),0)::int AS prompt_tokens,
              coalesce(sum(completion_tokens),0)::int AS completion_tokens,
              count(*) FILTER (WHERE NOT ok)::int AS failures
       FROM ai_usage WHERE created_at > now() - interval '24 hours'`,
    );
    const llmStats = ctx.llm.getStats();
    return {
      tickets: {
        open: counts.open, inProgress: counts.in_progress, critical: counts.critical,
        unassigned: counts.unassigned, overdue: counts.overdue,
      },
      ai: {
        providersConfigured: ctx.llm.configured(),
        triagePending: counts.triage_pending,
        categoryOverrideRate: counts.triaged ? counts.category_overrides / counts.triaged : 0,
        priorityOverrideRate: counts.triaged ? counts.priority_overrides / counts.triaged : 0,
        last24h: { calls: usage.calls, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, failures: usage.failures },
        dailyCap: llmStats.dailyCap,
        todayCalls: llmStats.todayCalls,
        enabled: llmStats.enabled,
      },
    };
  });

  // ------------------------------------------------------------------ one ticket
  app.get('/admin/tickets/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const loaded = await loadTicketContext(ctx.db, id, ctx.today());
    if (!loaded) throw notFound('Ticket');
    const [summaryRow] = await ctx.db.query(`${SUMMARY_SQL} WHERE t.id = $1`, [id]);
    const messages = await ctx.db.query(
      `SELECT m.*, u.name AS sender_name FROM ticket_messages m JOIN users u ON u.id = m.sender_id WHERE m.ticket_id = $1 ORDER BY m.id`,
      [id],
    );
    const events = await ctx.db.query(
      `SELECT e.id, e.type, e.detail, e.created_at, u.name AS actor_name FROM ticket_events e LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.ticket_id = $1 ORDER BY e.id DESC LIMIT 30`,
      [id],
    );
    const { ticket } = loaded;
    return {
      ticket: {
        ...adminTicketSummary(summaryRow),
        description: ticket.description,
        attachments: ticket.attachments,
        bookId: ticket.book_id,
        aiReasoning: ticket.ai_reasoning,
        resolvedAt: ticket.resolved_at,
        messages: messages.map(messageDto),
        events: events.map((e: any) => ({ id: e.id, type: e.type, detail: e.detail, actorName: e.actor_name, createdAt: e.created_at })),
      },
      facts: { asOf: ctx.today(), focusBookId: ticket.book_id, books: loaded.facts },
    };
  });

  app.patch('/admin/tickets/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = patchSchema.parse(req.body);
    const admin = req.user!;

    const updated = await ctx.db.tx(async (q) => {
      const [t] = await q.query<any>('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [id]);
      if (!t) throw notFound('Ticket');
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      const events: [string, object][] = [];

      let nextStatus = body.status;
      if (body.assignee === 'me') {
        set('assignee_id', admin.id);
        events.push(['assigned', { to: admin.name }]);
        if (!nextStatus && t.status === 'Open') nextStatus = 'In Progress'; // picking a ticket up starts work on it
      } else if (body.assignee === null) {
        set('assignee_id', null);
        events.push(['unassigned', {}]);
      } else if (typeof body.assignee === 'number') {
        const [target] = await q.query<{ id: number; name: string }>(
          `SELECT id, name FROM users WHERE id = $1 AND role = 'admin'`,
          [body.assignee],
        );
        if (!target) throw notFound('Admin user');
        set('assignee_id', target.id);
        events.push(['assigned', { to: target.name }]);
        if (!nextStatus && t.status === 'Open') nextStatus = 'In Progress';
      }
      if (nextStatus && nextStatus !== t.status) {
        set('status', nextStatus);
        set('resolved_at', isActive(nextStatus) ? null : new Date().toISOString());
        events.push(['status_changed', { from: t.status, to: nextStatus }]);
      }
      if (body.category && body.category !== t.category) {
        set('category', body.category);
        set('category_overridden', t.ai_category ? body.category !== t.ai_category : true);
        events.push(['category_changed', { from: t.category, to: body.category, aiSuggested: t.ai_category }]);
      }
      if (body.priority && body.priority !== t.priority) {
        set('priority', body.priority);
        set('priority_overridden', t.ai_priority ? body.priority !== t.ai_priority : true);
        events.push(['priority_changed', { from: t.priority, to: body.priority, aiSuggested: t.ai_priority }]);
      }
      if (sets.length) {
        await q.query(`UPDATE tickets SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length + 1}`, [...params, id]);
        for (const [type, detail] of events) {
          await q.query('INSERT INTO ticket_events (ticket_id, actor_id, type, detail) VALUES ($1,$2,$3,$4)', [id, admin.id, type, JSON.stringify(detail)]);
        }
      }
      return t.author_id as string;
    });
    ctx.hub.publish({ type: 'ticket.updated', ticketId: id, authorId: updated });
    return { ok: true };
  });

  // ------------------------------------------------------------------ conversation
  app.post('/admin/tickets/:id/notes', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { body } = noteSchema.parse(req.body);
    const t = await getTicket(ctx.db, id);
    if (!t) throw notFound('Ticket');
    await ctx.db.query(
      `INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, body, is_internal) VALUES ($1,$2,'admin',$3,TRUE)`,
      [id, req.user!.id, body],
    );
    ctx.hub.publish({ type: 'note.created', ticketId: id, authorId: t.author_id, adminOnly: true });
    return reply.code(201).send({ ok: true });
  });

  app.post('/admin/tickets/:id/reply', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { body, usedDraft, status } = replySchema.parse(req.body);
    const admin = req.user!;
    const t = await getTicket(ctx.db, id);
    if (!t) throw notFound('Ticket');
    if (t.status === 'Closed') throw conflict('TICKET_CLOSED', 'Closed tickets cannot be replied to. Reopen it first.');

    await ctx.db.tx(async (q) => {
      await q.query(
        `INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, body, ai_draft_used) VALUES ($1,$2,'admin',$3,$4)`,
        [id, admin.id, body, usedDraft],
      );
      const next = status ?? (t.status === 'Open' ? 'In Progress' : t.status);
      const claim = t.assignee_id === null; // replying to an unowned ticket takes ownership
      await q.query(
        `UPDATE tickets SET status = $2, resolved_at = $3, assignee_id = COALESCE(assignee_id, $4), updated_at = now() WHERE id = $1`,
        [id, next, isActive(next as any) ? null : new Date().toISOString(), admin.id],
      );
      await q.query('INSERT INTO ticket_events (ticket_id, actor_id, type, detail) VALUES ($1,$2,$3,$4)', [
        id, admin.id, 'replied', JSON.stringify({ usedDraft, statusAfter: next, claimed: claim }),
      ]);
    });
    ctx.hub.publish({ type: 'message.created', ticketId: id, authorId: t.author_id });
    return reply.code(201).send({ ok: true });
  });

  // ------------------------------------------------------------------ AI
  app.get('/admin/tickets/:id/draft', async (req) => {
    const { id } = idParam.parse(req.params);
    const draft = await getDraft(ctx, id);
    if (!draft) throw notFound('Ticket');
    return { draft };
  });

  app.post(
    '/admin/tickets/:id/draft',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 hour',
          keyGenerator: (req) => String(req.user?.id ?? req.ip),
        },
      },
    },
    async (req) => {
    const { id } = idParam.parse(req.params);
    const { instruction } = draftSchema.parse(req.body ?? {});
    const draft = await getDraft(ctx, id, { force: true, instruction });
    if (!draft) throw notFound('Ticket');
    return { draft };
  });

  app.post('/admin/tickets/:id/reclassify', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!(await getTicket(ctx.db, id))) throw notFound('Ticket');
    queueTriage(ctx, id);
    return reply.code(202).send({ status: 'queued' });
  });

  // ------------------------------------------------------------------ admin team
  app.get('/admin/admins', async () => {
    const admins = await ctx.db.query<{ id: number; name: string; email: string }>(
      `SELECT id, name, email FROM users WHERE role = 'admin' ORDER BY name ASC`,
    );
    return { admins };
  });
}

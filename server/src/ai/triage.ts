import { z } from 'zod';
import type { Ctx } from '../context';
import { normalizeCategory, normalizePriority } from '../domain/constants';
import { loadTicketContext } from '../lib/ticketData';
import { applyPolicyFloors, ruleClassify, type Classification } from './fallback';
import { LlmUnavailableError } from './types';
import { buildTriageUser, TRIAGE_SYSTEM } from './prompts';

const rawSchema = z.object({
  category: z.unknown(),
  priority: z.unknown(),
  reasoning: z.unknown().optional(),
});

/** Parse and validate model output. Anything malformed returns null (we then use rules). */
export function parseTriageOutput(text: string): Classification | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let json: unknown;
  try {
    json = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const raw = rawSchema.safeParse(json);
  if (!raw.success) return null;
  const category = normalizeCategory(raw.data.category);
  const priority = normalizePriority(raw.data.priority);
  if (!category || !priority) return null;
  const reasoning = typeof raw.data.reasoning === 'string' ? raw.data.reasoning.slice(0, 240) : '';
  return { category, priority, reasoning };
}

/**
 * Classify + prioritise one ticket and persist the result.
 * Never throws to the caller for AI reasons: if the model is down, the rules engine answers
 * and the ticket is still fully usable. The author's submit request never waits on this.
 */
export async function triageTicket(ctx: Ctx, ticketId: number): Promise<void> {
  const loaded = await loadTicketContext(ctx.db, ticketId, ctx.today());
  if (!loaded) return;
  const { ticket, focus } = loaded;
  const text = `${ticket.subject}\n${ticket.description}`;

  let cls: Classification;
  let source: 'llm' | 'rules' = 'rules';
  const bookLine = focus ? `Book: "${focus.title}" (${focus.status})` : 'Book: none (account-level query)';

  try {
    const res = await ctx.llm.generate({
      tier: 'fast',
      json: true,
      maxTokens: 160,
      temperature: 0,
      system: TRIAGE_SYSTEM,
      user: buildTriageUser({ subject: ticket.subject, description: ticket.description, bookLine }),
    });
    const parsed = parseTriageOutput(res.text);
    await recordUsage(ctx, ticketId, 'triage', res.provider, res.model, res.promptTokens, res.completionTokens, res.latencyMs, !!parsed, parsed ? null : 'unparseable output');
    if (!parsed) throw new Error('model returned unparseable output');
    cls = parsed;
    source = 'llm';
  } catch (e) {
    if (e instanceof LlmUnavailableError) {
      await recordUsage(ctx, ticketId, 'triage', null, null, 0, 0, 0, false, e.attempts.join(' | ').slice(0, 400));
    }
    ctx.log.warn({ ticketId, err: (e as Error).message }, 'triage: falling back to rules');
    cls = ruleClassify(ticket.subject, ticket.description);
    source = 'rules';
  }

  cls = applyPolicyFloors(cls, text, focus);

  await ctx.db.query(
    `UPDATE tickets SET
       ai_category = $2, ai_priority = $3, ai_reasoning = $4, ai_status = $5,
       category = CASE WHEN category_overridden THEN category ELSE $2 END,
       priority = CASE WHEN priority_overridden THEN priority ELSE $3 END
     WHERE id = $1`,
    [ticketId, cls.category, cls.priority, cls.reasoning, source],
  );
  await ctx.db.query(`INSERT INTO ticket_events (ticket_id, type, detail) VALUES ($1, 'ai_triaged', $2)`, [
    ticketId,
    JSON.stringify({ category: cls.category, priority: cls.priority, source }),
  ]);
  ctx.hub.publish({ type: 'ticket.updated', ticketId, authorId: ticket.author_id });
}

export async function recordUsage(
  ctx: Ctx,
  ticketId: number | null,
  kind: string,
  provider: string | null,
  model: string | null,
  promptTokens: number,
  completionTokens: number,
  latencyMs: number,
  ok: boolean,
  error: string | null,
) {
  try {
    await ctx.db.query(
      `INSERT INTO ai_usage (ticket_id, kind, provider, model, prompt_tokens, completion_tokens, latency_ms, ok, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [ticketId, kind, provider, model, promptTokens, completionTokens, latencyMs, ok, error],
    );
  } catch (e) {
    ctx.log.warn({ err: (e as Error).message }, 'could not record ai usage');
  }
}

/** Fire-and-forget wrapper used by routes. */
export function queueTriage(ctx: Ctx, ticketId: number) {
  setImmediate(() => {
    triageTicket(ctx, ticketId).catch((e) => ctx.log.error({ ticketId, err: (e as Error).message }, 'triage crashed'));
  });
}

/**
 * Durability for the "queue": on boot, pick up tickets whose triage never finished
 * (server restarted mid-flight). A real deployment would use BullMQ / pg-boss instead.
 */
export async function resumePendingTriage(ctx: Ctx) {
  const rows = await ctx.db.query<{ id: number }>(
    `SELECT id FROM tickets WHERE ai_status = 'pending' ORDER BY id LIMIT 25`,
  );
  rows.forEach((r) => queueTriage(ctx, r.id));
}

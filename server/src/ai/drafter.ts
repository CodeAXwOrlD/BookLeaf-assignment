import type { Ctx } from '../context';
import { CATEGORIES, type Category } from '../domain/constants';
import { factsToPrompt } from '../domain/facts';
import { loadTicketContext } from '../lib/ticketData';
import { templateDraft } from './fallback';
import { buildDraftUser, cleanDraft, DRAFT_SYSTEM } from './prompts';
import { recordUsage } from './triage';
import { LlmUnavailableError } from './types';

export interface DraftDto {
  body: string;
  source: 'llm' | 'template';
  provider: string | null;
  model: string | null;
  generatedAt: string;
  /** Why we fell back to a template (only known on the request that generated it). */
  fallbackReason?: string;
  cached: boolean;
}

interface DraftRow {
  body: string;
  source: 'llm' | 'template';
  provider: string | null;
  model: string | null;
  based_on_message: number;
  created_at: string | Date;
}

const inFlight = new Map<number, Promise<DraftDto>>();

/**
 * Cost controls, in order of impact:
 *  1. Lazy: nothing is generated until an admin opens the ticket.
 *  2. Cached per ticket, regenerated only if the author replied since (new visible message) or the admin asks.
 *  3. De-duplicated: two admins opening the same ticket share one in-flight call.
 *  4. Small prompt: only the KB slice for this ticket's category, only this book's facts,
 *     last 4 messages, internal notes never included, output capped at ~450 tokens.
 */
export async function getDraft(
  ctx: Ctx,
  ticketId: number,
  opts: { force?: boolean; instruction?: string } = {},
): Promise<DraftDto | null> {
  const existing = inFlight.get(ticketId);
  if (existing && !opts.instruction) return existing;

  const job = produce(ctx, ticketId, opts).finally(() => inFlight.delete(ticketId));
  if (!opts.instruction) inFlight.set(ticketId, job as Promise<DraftDto>);
  return job;
}

async function produce(ctx: Ctx, ticketId: number, opts: { force?: boolean; instruction?: string }): Promise<DraftDto | null> {
  const loaded = await loadTicketContext(ctx.db, ticketId, ctx.today());
  if (!loaded) return null;
  const { ticket, firstName, facts, focus } = loaded;

  const thread = await ctx.db.query<{ id: number; sender_role: 'author' | 'admin'; body: string }>(
    `SELECT id, sender_role, body FROM ticket_messages WHERE ticket_id = $1 AND is_internal = FALSE ORDER BY id`,
    [ticketId],
  );
  const latestId = thread.length ? thread[thread.length - 1].id : 0;

  if (!opts.force && !opts.instruction) {
    const [cached] = await ctx.db.query<DraftRow>('SELECT * FROM ai_drafts WHERE ticket_id = $1', [ticketId]);
    if (cached && cached.based_on_message === latestId) {
      return {
        body: cached.body,
        source: cached.source,
        provider: cached.provider,
        model: cached.model,
        generatedAt: new Date(cached.created_at).toISOString(),
        cached: true,
      };
    }
  }

  const category = (CATEGORIES as readonly string[]).includes(ticket.category) ? (ticket.category as Category) : 'General Inquiry';
  let body: string | null = null;
  let provider: string | null = null;
  let model: string | null = null;
  let fallbackReason: string | undefined;

  if (ctx.llm.configured().length === 0) {
    fallbackReason = 'No LLM API key is configured';
  } else {
    try {
      const res = await ctx.llm.generate({
        tier: 'draft',
        maxTokens: 450,
        temperature: 0.4,
        system: DRAFT_SYSTEM,
        user: buildDraftUser({
          category,
          authorFirstName: firstName,
          facts: factsToPrompt(facts, ticket.book_id, ctx.today()),
          subject: ticket.subject,
          description: ticket.description,
          thread: thread.map((m) => ({ role: m.sender_role, body: m.body })),
          instruction: opts.instruction,
        }),
      });
      body = cleanDraft(res.text);
      await recordUsage(ctx, ticketId, 'draft', res.provider, res.model, res.promptTokens, res.completionTokens, res.latencyMs, !!body, body ? null : 'draft rejected by sanity check');
      if (body) {
        provider = res.provider;
        model = res.model;
      } else fallbackReason = 'Model output failed the sanity check';
    } catch (e) {
      if (e instanceof LlmUnavailableError) {
        await recordUsage(ctx, ticketId, 'draft', null, null, 0, 0, 0, false, e.attempts.join(' | ').slice(0, 400));
        fallbackReason = 'AI providers are unavailable right now';
      } else {
        fallbackReason = 'Unexpected AI error';
      }
      ctx.log.warn({ ticketId, err: (e as Error).message }, 'draft: falling back to template');
    }
  }

  const source: 'llm' | 'template' = body ? 'llm' : 'template';
  if (!body) body = templateDraft(category, { firstName, subject: ticket.subject, description: ticket.description, focus });

  await ctx.db.query(
    `INSERT INTO ai_drafts (ticket_id, body, source, provider, model, based_on_message, created_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (ticket_id) DO UPDATE SET body = $2, source = $3, provider = $4, model = $5,
       based_on_message = $6, created_at = now()`,
    [ticketId, body, source, provider, model, latestId],
  );
  return { body, source, provider, model, generatedAt: new Date().toISOString(), fallbackReason, cached: false };
}

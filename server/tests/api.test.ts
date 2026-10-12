import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createLlm } from '../src/ai/llm';
import { buildApp } from '../src/app';
import { loadConfig, todayISO } from '../src/config';
import type { Ctx } from '../src/context';
import { createDb } from '../src/db';
import { Hub } from '../src/realtime/hub';
import { seedDatabase } from '../src/seed/seed';

let app: FastifyInstance;
let ctx: Ctx;
const cookies: Record<string, string> = {};

async function login(email: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  cookies[email] = String(res.cookies[0].name) + '=' + res.cookies[0].value;
  return res;
}
const as = (email: string) => ({ cookie: cookies[email] });

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: 'test', PGLITE_DIR: 'memory', APP_TODAY: '2026-10-10', JWT_SECRET: 'test-secret-test-secret' } as any);
  const db = await createDb(config);
  ctx = { config, db, hub: new Hub(), llm: createLlm(config.llm), log: { info() { }, warn() { }, error() { } }, today: () => todayISO(config) };
  await seedDatabase(ctx);
  app = await buildApp(ctx);
  await login('ananya.reddy@email.com', 'bookleaf123');
  await login('arjun.malhotra@email.com', 'bookleaf123');
  await login('admin@bookleaf.in', 'admin123');
}, 60_000);

afterAll(async () => {
  ctx.hub.close();
  await app.close();
  await ctx.db.close();
});

describe('auth and role-based access', () => {
  it('rejects unauthenticated requests', async () => {
    expect((await app.inject({ url: '/api/v1/books' })).statusCode).toBe(401);
  });
  it('rejects wrong password with the same message as unknown email', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'ananya.reddy@email.com', password: 'nope' } });
    const b = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'ghost@x.com', password: 'nope' } });
    expect(a.statusCode).toBe(401);
    expect(a.json().error.message).toBe(b.json().error.message);
  });
  it('authors cannot reach admin endpoints', async () => {
    expect((await app.inject({ url: '/api/v1/admin/tickets', headers: as('ananya.reddy@email.com') })).statusCode).toBe(403);
  });
  it('authors only see their own books', async () => {
    const res = await app.inject({ url: '/api/v1/books', headers: as('ananya.reddy@email.com') });
    expect(res.json().books.map((b: any) => b.bookId)).toEqual(['BK005']);
  });
  it('admin cannot use author-only endpoints', async () => {
    expect((await app.inject({ url: '/api/v1/tickets', headers: as('admin@bookleaf.in') })).statusCode).toBe(403);
  });
});

describe('ticket lifecycle', () => {
  let ticketId: number;
  it('validates input with a structured error', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tickets', headers: as('ananya.reddy@email.com'), payload: { subject: 'x', description: 'y' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
  it('rejects a book that belongs to someone else', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tickets', headers: as('ananya.reddy@email.com'), payload: { bookId: 'BK001', subject: 'Not my book', description: 'This is not my book at all' } });
    expect(res.statusCode).toBe(400);
  });
  it('creates a ticket even with no AI configured, then triages with rules', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tickets', headers: as('ananya.reddy@email.com'), payload: { bookId: 'BK005', subject: 'Unavailable on Amazon', description: 'My book shows Currently Unavailable on Amazon India.' } });
    expect(res.statusCode).toBe(201);
    ticketId = res.json().ticket.id;
    await new Promise((r) => setTimeout(r, 400));
    const admin = await app.inject({ url: `/api/v1/admin/tickets/${ticketId}`, headers: as('admin@bookleaf.in') });
    expect(admin.json().ticket.category).toBe('Distribution & Availability');
    expect(admin.json().ticket.priority).toBe('High');
    expect(admin.json().ticket.aiStatus).toBe('rules');
  });
  it('admin override sticks and is flagged', async () => {
    await app.inject({ method: 'PATCH', url: `/api/v1/admin/tickets/${ticketId}`, headers: as('admin@bookleaf.in'), payload: { priority: 'Critical' } });
    const t = (await app.inject({ url: `/api/v1/admin/tickets/${ticketId}`, headers: as('admin@bookleaf.in') })).json().ticket;
    expect(t.priority).toBe('Critical');
    expect(t.priorityOverridden).toBe(true);
    expect(t.aiPriority).toBe('High');
  });
  it('internal notes never reach the author, replies do', async () => {
    const h = as('admin@bookleaf.in');
    await app.inject({ method: 'POST', url: `/api/v1/admin/tickets/${ticketId}/notes`, headers: h, payload: { body: 'SECRET internal note' } });
    await app.inject({ method: 'POST', url: `/api/v1/admin/tickets/${ticketId}/reply`, headers: h, payload: { body: 'Re-sync triggered.', usedDraft: false } });
    const t = (await app.inject({ url: `/api/v1/tickets/${ticketId}`, headers: as('ananya.reddy@email.com') })).json().ticket;
    const bodies = t.messages.map((m: any) => m.body);
    expect(bodies).toContain('Re-sync triggered.');
    expect(JSON.stringify(t)).not.toContain('SECRET');
    expect(t.status).toBe('In Progress');
  });
  it("another author gets 404 for this ticket", async () => {
    expect((await app.inject({ url: `/api/v1/tickets/${ticketId}`, headers: as('arjun.malhotra@email.com') })).statusCode).toBe(404);
  });
  it('admin gets a template draft when no LLM key is set', async () => {
    const d = (await app.inject({ url: `/api/v1/admin/tickets/${ticketId}/draft`, headers: as('admin@bookleaf.in') })).json().draft;
    expect(d.source).toBe('template');
    expect(d.body).toContain('Hi Ananya');
  });
  it('author reply on a resolved ticket reopens it', async () => {
    await app.inject({ method: 'PATCH', url: `/api/v1/admin/tickets/${ticketId}`, headers: as('admin@bookleaf.in'), payload: { status: 'Resolved' } });
    await app.inject({ method: 'POST', url: `/api/v1/tickets/${ticketId}/messages`, headers: as('ananya.reddy@email.com'), payload: { body: 'Still not showing, sorry.' } });
    const t = (await app.inject({ url: `/api/v1/tickets/${ticketId}`, headers: as('ananya.reddy@email.com') })).json().ticket;
    expect(t.status).toBe('Open');
  });
  it('admin can list team members and assign a ticket to another admin', async () => {
    const adminsRes = await app.inject({ url: '/api/v1/admin/admins', headers: as('admin@bookleaf.in') });
    expect(adminsRes.statusCode).toBe(200);
    const admins = adminsRes.json().admins;
    expect(admins.length).toBeGreaterThanOrEqual(2);
    const opsAdmin = admins.find((a: any) => a.email === 'ops@bookleaf.in');
    expect(opsAdmin).toBeDefined();

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/tickets/${ticketId}`,
      headers: as('admin@bookleaf.in'),
      payload: { assignee: opsAdmin.id },
    });
    expect(patchRes.statusCode).toBe(200);

    const detailRes = await app.inject({ url: `/api/v1/admin/tickets/${ticketId}`, headers: as('admin@bookleaf.in') });
    expect(detailRes.json().ticket.assigneeId).toBe(opsAdmin.id);
  });
  it('tracks server-side unread state when author views the ticket', async () => {
    // Admin sends reply
    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/tickets/${ticketId}/reply`,
      headers: as('admin@bookleaf.in'),
      payload: { body: 'Checking back with you.' },
    });
    // Author ticket list shows unread: true
    const listBefore = await app.inject({ url: '/api/v1/tickets', headers: as('ananya.reddy@email.com') });
    const itemBefore = listBefore.json().tickets.find((t: any) => t.id === ticketId);
    expect(itemBefore.unread).toBe(true);

    // Author opens detail view (upserting read timestamp)
    await app.inject({ url: `/api/v1/tickets/${ticketId}`, headers: as('ananya.reddy@email.com') });

    // Author ticket list now shows unread: false
    const listAfter = await app.inject({ url: '/api/v1/tickets', headers: as('ananya.reddy@email.com') });
    const itemAfter = listAfter.json().tickets.find((t: any) => t.id === ticketId);
    expect(itemAfter.unread).toBe(false);
  });
  it('returns a clean 413 JSON when body exceeds 256 KB limit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tickets',
      headers: { ...as('ananya.reddy@email.com'), 'content-type': 'application/json' },
      payload: 'x'.repeat(300 * 1024),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('BODY_TOO_LARGE');
  });
  it('returns clean 429 JSON on login abuse', async () => {
    let lastRes;
    for (let i = 0; i < 10; i++) {
      lastRes = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'brute@example.com', password: 'nope' } });
      if (lastRes.statusCode === 429) break;
    }
    expect(lastRes?.statusCode).toBe(429);
    expect(lastRes?.json().error.code).toBe('RATE_LIMITED');
    expect(lastRes?.json().error.message).toContain('Too many requests');
  });
  it('cap reached falls back to rules and still creates the ticket', async () => {
    ctx.llm.setTodayCalls(ctx.config.llm.dailyCap);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tickets',
      headers: as('ananya.reddy@email.com'),
      payload: { bookId: 'BK005', subject: 'Cap check unavailable on Amazon', description: 'My book shows Currently Unavailable on Amazon India.' },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().ticket.id;
    await new Promise((r) => setTimeout(r, 400));
    const admin = await app.inject({ url: `/api/v1/admin/tickets/${id}`, headers: as('admin@bookleaf.in') });
    expect(admin.json().ticket.aiStatus).toBe('rules');
    ctx.llm.setTodayCalls(0);
  });
  it('kill switch behaves the same (falls back to rules and still creates ticket)', async () => {
    ctx.config.llm.enabled = false;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tickets',
      headers: as('ananya.reddy@email.com'),
      payload: { bookId: 'BK005', subject: 'Killswitch test query', description: 'When will my book proofs be printed and delivered?' },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().ticket.id;
    await new Promise((r) => setTimeout(r, 400));
    const admin = await app.inject({ url: `/api/v1/admin/tickets/${id}`, headers: as('admin@bookleaf.in') });
    expect(admin.json().ticket.aiStatus).toBe('rules');
    ctx.config.llm.enabled = true;
  });
  it('a 11th ticket in an hour returns 429 RATE_LIMITED', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tickets',
        headers: as('arjun.malhotra@email.com'),
        payload: { bookId: 'BK010', subject: `Rate limit ticket ${i}`, description: 'Testing ticket rate limiting per user.' },
      });
      expect(res.statusCode).toBe(201);
    }
    const eleventh = await app.inject({
      method: 'POST',
      url: '/api/v1/tickets',
      headers: as('arjun.malhotra@email.com'),
      payload: { bookId: 'BK010', subject: 'Eleventh ticket', description: 'This one must be blocked by rate limit.' },
    });
    expect(eleventh.statusCode).toBe(429);
    expect(eleventh.json().error.code).toBe('RATE_LIMITED');
  });
});

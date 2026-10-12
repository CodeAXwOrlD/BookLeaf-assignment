import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { Ctx } from './context';
import { AppError, notFound } from './errors';
import { adminRoutes } from './modules/admin.routes';
import { authRoutes } from './modules/auth.routes';
import { bookRoutes } from './modules/books.routes';
import { streamRoutes } from './modules/stream.routes';
import { ticketRoutes } from './modules/tickets.routes';
import { authenticate, requireRole } from './plugins/auth';

const API = '/api/v1';
const PUBLIC_PATHS = new Set([`${API}/auth/login`, `${API}/auth/logout`, `${API}/auth/demo-accounts`, `${API}/health`]);

export async function buildApp(ctx: Ctx, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 256 * 1024 });

  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  // ---- one error shape for everything: { error: { code, message, details? } }
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: err.issues[0]?.message ?? 'Invalid request',
          details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        },
      });
    }
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as any).statusCode as number | undefined;
    if (status && status >= 400 && status < 500) {
      const errCode = (err as any).code as string | undefined;
      const code =
        status === 429 ? 'RATE_LIMITED' :
        errCode === 'FST_ERR_CTP_BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' :
        errCode === 'FST_ERR_CTP_INVALID_JSON_BODY' ? 'INVALID_JSON' :
        'BAD_REQUEST';
      const message =
        status === 429 ? 'Too many requests. Please slow down.' :
        code === 'BODY_TOO_LARGE' ? 'Request body is too large (max 256 KB).' :
        (err as Error).message;
      return reply.code(status).send({ error: { code, message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } });
  });

  // ---- authentication middleware: every /api/v1 route requires a valid session except the public list
  const auth = authenticate(ctx.config);
  app.addHook('onRequest', async (req) => {
    const path = req.url.split('?')[0];
    if (path.startsWith(API) && !PUBLIC_PATHS.has(path)) await auth(req);
  });

  app.register(
    async (api) => {
      api.get('/health', async () => ({ status: 'ok', db: ctx.db.kind, aiProviders: ctx.llm.configured() }));
      await authRoutes(api, ctx);
      await bookRoutes(api, ctx); // role-aware inside
      await streamRoutes(api, ctx);

      // author-only
      await api.register(async (authorScope) => {
        authorScope.addHook('onRequest', requireRole('author'));
        await ticketRoutes(authorScope, ctx);
      });
      // admin-only
      await api.register(async (adminScope) => {
        adminScope.addHook('onRequest', requireRole('admin'));
        await adminRoutes(adminScope, ctx);
      });
    },
    { prefix: API },
  );

  // ---- serve the built frontend (single-service deploy) with SPA fallback
  const dist = resolve(ctx.config.webDist);
  const hasWeb = existsSync(resolve(dist, 'index.html'));
  if (hasWeb) await app.register(fastifyStatic, { root: dist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith(API) || !hasWeb || req.method !== 'GET') {
      const e = notFound('Endpoint');
      return reply.code(e.status).send({ error: { code: e.code, message: e.message } });
    }
    return reply.sendFile('index.html');
  });

  return app;
}

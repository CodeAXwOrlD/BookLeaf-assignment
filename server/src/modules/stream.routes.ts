import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context';

/**
 * GET /api/v1/stream  (Server-Sent Events)
 * Why SSE: updates only flow server -> browser, EventSource reconnects by itself, it works through
 * normal HTTP proxies, and it sends the session cookie automatically. WebSockets would add
 * a second protocol for no benefit here.
 */
export async function streamRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/stream', (req, reply) => {
    const user = req.user!;
    reply.hijack(); // we own the socket from here
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // tell nginx-style proxies not to buffer
    });
    res.write('retry: 3000\n: connected\n\n');
    ctx.hub.add({ res, role: user.role, authorId: user.authorId });
  });
}

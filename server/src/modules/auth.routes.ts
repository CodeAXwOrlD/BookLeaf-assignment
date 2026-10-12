import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Ctx } from '../context';
import { unauthorized } from '../errors';
import { COOKIE_NAME, setAuthCookie, signToken, type AuthUser } from '../plugins/auth';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required').max(200),
});

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export async function authRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { email, password } = loginSchema.parse(req.body);
      const [row] = await ctx.db.query<{
        id: number; email: string; password_hash: string; name: string; role: 'author' | 'admin'; author_id: string | null;
      }>('SELECT * FROM users WHERE email = $1', [email]);
      const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
      if (!row || !ok) throw unauthorized('Invalid email or password');

      const user: AuthUser = { id: row.id, role: row.role, authorId: row.author_id, name: row.name, email: row.email };
      setAuthCookie(reply, ctx.config, signToken(ctx.config, user));
      return { user };
    },
  );

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', async (req) => ({ user: req.user }));

  // Demo helper so reviewers can sign in with one click. Disabled unless DEMO_MODE=true.
  app.get('/auth/demo-accounts', async () => {
    if (!ctx.config.demoMode) return { enabled: false, accounts: [] };
    const rows = await ctx.db.query<{ email: string; name: string; role: string }>(
      `SELECT email, name, role FROM users ORDER BY role DESC, id`,
    );
    return {
      enabled: true,
      authorPassword: ctx.config.seedAuthorPassword,
      adminPassword: ctx.config.seedAdminPassword,
      accounts: rows,
    };
  });
}

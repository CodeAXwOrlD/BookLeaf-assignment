import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context';
import type { BookRow } from '../domain/facts';
import { bookDto } from './dto';

const querySchema = z.object({ authorId: z.string().max(20).optional() });

export async function bookRoutes(app: FastifyInstance, ctx: Ctx) {
  // Authors always get their own books (the id comes from the signed token, never from the request).
  // Admins may filter with ?authorId=.
  app.get('/books', async (req) => {
    const { authorId } = querySchema.parse(req.query);
    const user = req.user!;
    const scope = user.role === 'author' ? user.authorId : authorId ?? null;
    const rows = scope
      ? await ctx.db.query<BookRow>('SELECT * FROM books WHERE author_id = $1 ORDER BY book_id', [scope])
      : await ctx.db.query<BookRow>('SELECT * FROM books ORDER BY book_id');
    const asOf = ctx.today();
    return { asOf, books: rows.map((r) => bookDto(r, asOf)) };
  });
}

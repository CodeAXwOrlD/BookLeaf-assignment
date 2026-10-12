import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import type { Config } from '../config';
import { forbidden, unauthorized } from '../errors';

export interface AuthUser {
  id: number;
  role: 'author' | 'admin';
  authorId: string | null;
  name: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export const COOKIE_NAME = 'bl_token';
const WEEK_SECONDS = 7 * 24 * 3600;

export function signToken(config: Pick<Config, 'jwtSecret'>, user: AuthUser): string {
  return jwt.sign(user, config.jwtSecret, { expiresIn: WEEK_SECONDS, issuer: 'bookleaf-portal' });
}

export function setAuthCookie(reply: FastifyReply, config: Pick<Config, 'isProd'>, token: string) {
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true, // not readable from JS, so XSS can't steal the session
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
    maxAge: WEEK_SECONDS,
  });
}

/** Cookie first (browser, incl. EventSource), then Authorization: Bearer (Postman / scripts). */
export function readToken(req: FastifyRequest): string | null {
  const cookie = req.cookies?.[COOKIE_NAME];
  if (cookie) return cookie;
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

export function authenticate(config: Pick<Config, 'jwtSecret'>) {
  return async (req: FastifyRequest) => {
    const token = readToken(req);
    if (!token) throw unauthorized();
    try {
      const p = jwt.verify(token, config.jwtSecret, { issuer: 'bookleaf-portal' }) as AuthUser;
      req.user = { id: p.id, role: p.role, authorId: p.authorId, name: p.name, email: p.email };
    } catch {
      throw unauthorized('Session expired. Please sign in again.');
    }
  };
}

export const requireRole = (role: 'author' | 'admin') => async (req: FastifyRequest) => {
  if (!req.user) throw unauthorized();
  if (req.user.role !== role) throw forbidden(`This endpoint is for ${role}s only`);
};

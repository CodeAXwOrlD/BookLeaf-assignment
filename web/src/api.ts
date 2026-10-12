import type {
  AdminTicketDetail, AdminTicketSummary, AuthorTicketDetail, AuthorTicketSummary, BookFacts, Book,
  DemoAccounts, Draft, Stats, User,
} from './types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: { field: string; message: string }[]) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('auth:expired'));
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? 'Something went wrong', e?.details);
  }
  return data as T;
}

const qs = (o: Record<string, string | number | undefined | string[]>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  login: (email: string, password: string) => request<{ user: User }>('POST', '/auth/login', { email, password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  me: () => request<{ user: User }>('GET', '/auth/me'),
  demoAccounts: () => request<DemoAccounts>('GET', '/auth/demo-accounts'),

  books: () => request<{ asOf: string; books: Book[] }>('GET', '/books'),

  myTickets: () => request<{ tickets: AuthorTicketSummary[] }>('GET', '/tickets'),
  myTicket: (id: number) => request<{ ticket: AuthorTicketDetail }>('GET', `/tickets/${id}`),
  createTicket: (b: { bookId: string | null; subject: string; description: string; attachments: { name: string; size: number; type: string }[] }) =>
    request<{ ticket: AuthorTicketSummary }>('POST', '/tickets', b),
  replyToTicket: (id: number, body: string) => request<{ ok: true }>('POST', `/tickets/${id}/messages`, { body }),

  adminStats: () => request<Stats>('GET', '/admin/stats'),
  adminTickets: (f: Record<string, string | number | undefined | string[]>) =>
    request<{ total: number; page: number; pageSize: number; tickets: AdminTicketSummary[] }>('GET', `/admin/tickets${qs(f)}`),
  adminTicket: (id: number) =>
    request<{ ticket: AdminTicketDetail; facts: { asOf: string; focusBookId: string | null; books: BookFacts[] } }>('GET', `/admin/tickets/${id}`),
  patchTicket: (id: number, patch: Record<string, unknown>) => request<{ ok: true }>('PATCH', `/admin/tickets/${id}`, patch),
  addNote: (id: number, body: string) => request<{ ok: true }>('POST', `/admin/tickets/${id}/notes`, { body }),
  adminReply: (id: number, b: { body: string; usedDraft: boolean; status?: string }) => request<{ ok: true }>('POST', `/admin/tickets/${id}/reply`, b),
  getDraft: (id: number) => request<{ draft: Draft }>('GET', `/admin/tickets/${id}/draft`),
  regenerateDraft: (id: number, instruction?: string) => request<{ draft: Draft }>('POST', `/admin/tickets/${id}/draft`, { instruction }),
  reclassify: (id: number) => request<{ status: string }>('POST', `/admin/tickets/${id}/reclassify`),
  adminAdmins: () => request<{ admins: { id: number; name: string; email: string }[] }>('GET', '/admin/admins'),
};

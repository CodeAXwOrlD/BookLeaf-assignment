import type { ServerResponse } from 'node:http';

/**
 * In-memory pub/sub feeding Server-Sent Events.
 * Events carry only ids and a type, never ticket text, so there is nothing sensitive to leak
 * onto the wrong stream. Clients react by re-fetching through the normal, access-checked API.
 *
 * Limitation (documented in README): in-memory means one server process. To scale out, swap
 * publish() for Postgres LISTEN/NOTIFY or Redis pub/sub; the interface stays the same.
 */

export type HubEvent = {
  type: 'ticket.created' | 'ticket.updated' | 'message.created' | 'note.created';
  ticketId: number;
  authorId: string;
  /** If true only admins receive it (e.g. internal notes). */
  adminOnly?: boolean;
};

interface Client {
  res: ServerResponse;
  role: 'author' | 'admin';
  authorId: string | null;
}

export class Hub {
  private clients = new Set<Client>();
  private beat: NodeJS.Timeout;

  constructor() {
    this.beat = setInterval(() => this.broadcastRaw(': keep-alive\n\n'), 25_000);
    this.beat.unref();
  }

  add(client: Client) {
    this.clients.add(client);
    client.res.on('close', () => this.clients.delete(client));
  }

  get size() {
    return this.clients.size;
  }

  publish(evt: HubEvent) {
    const payload = `event: ${evt.type}\ndata: ${JSON.stringify({ ticketId: evt.ticketId })}\n\n`;
    for (const c of this.clients) {
      const allowed = c.role === 'admin' || (!evt.adminOnly && c.authorId === evt.authorId);
      if (allowed) this.safeWrite(c, payload);
    }
  }

  private broadcastRaw(chunk: string) {
    for (const c of this.clients) this.safeWrite(c, chunk);
  }

  private safeWrite(c: Client, chunk: string) {
    try {
      c.res.write(chunk);
    } catch {
      this.clients.delete(c);
    }
  }

  close() {
    clearInterval(this.beat);
    for (const c of this.clients) c.res.end();
    this.clients.clear();
  }
}

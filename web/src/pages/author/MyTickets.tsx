import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { ago, fmtDateTime } from '../../format';
import type { AuthorTicketDetail, AuthorTicketSummary } from '../../types';
import { Empty, Loading, Notice, StatusPill } from '../../ui/Marks';
import { useLiveEvents } from '../liveContext';



export function MyTickets() {
  const { id } = useParams();
  const selectedId = id ? Number(id) : null;
  const [tickets, setTickets] = useState<AuthorTicketSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Set<number>>(new Set());

  const loadList = useCallback(async () => {
    try {
      const r = await api.myTickets();
      setTickets(r.tickets);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your queries');
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // Real time: any event for this author re-fetches the list; the open ticket refreshes itself too.
  useLiveEvents((e) => {
    loadList();
    if (e.ticketId) {
      setFlash((s) => new Set(s).add(e.ticketId));
      setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(e.ticketId); return n; }), 2600);
    }
  });

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!tickets) return <Loading label="Fetching your queries" />;

  if (!tickets.length) {
    return (
      <Empty title="You have not raised any queries">
        When you do, our replies show up here without you needing to refresh. <Link to="/query/new">Raise your first query</Link>.
      </Empty>
    );
  }

  return (
    <div className="split">
      <aside className="split-list" aria-label="Your queries">
        <h1 className="sr-only">Your queries</h1>
        <ul>
          {tickets.map((t) => (
            <li key={t.id}>
              <Link to={`/tickets/${t.id}`} className={`trow ${t.id === selectedId ? 'is-selected' : ''} ${flash.has(t.id) ? 'fresh' : ''}`} aria-current={t.id === selectedId ? 'page' : undefined}>
                <span className="trow-subject">{t.subject}</span>
                <span className="trow-meta">
                  <StatusPill status={t.status} />
                  <span className="muted">{t.bookTitle ?? 'General'}</span>
                </span>
                <span className="trow-foot muted">
                  {ago(t.updatedAt)}
                  {t.unread && t.id !== selectedId && <b className="newtag">New reply</b>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <section className="split-detail">
        {selectedId ? <TicketThread key={selectedId} id={selectedId} onChanged={loadList} /> : (
          <Empty title="Choose a query">Pick one from the list to read the thread.</Empty>
        )}
      </section>
    </div>
  );
}

function TicketThread({ id, onChanged }: { id: number; onChanged: () => void }) {
  const loc = useLocation();
  const justCreated = (loc.state as { justCreated?: boolean } | null)?.justCreated;
  const [t, setT] = useState<AuthorTicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const known = useRef<Set<number> | null>(null);

  const load = useCallback(async () => {
    try {
      const { ticket } = await api.myTicket(id);
      const ids = new Set(ticket.messages.map((m) => m.id));
      if (known.current) {
        const added = [...ids].filter((x) => !known.current!.has(x));
        if (added.length) {
          setFresh(new Set(added));
          setTimeout(() => setFresh(new Set()), 2600);
        }
      }
      known.current = ids;
      setT(ticket);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? (e.status === 404 ? 'We could not find that query.' : e.message) : 'Could not load this query');
    }
  }, [id, onChanged]);

  useEffect(() => { load(); }, [load]);
  useLiveEvents((e) => { if (e.ticketId === id || e.type === 'resync') load(); });

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.replyToTicket(id, reply);
      setReply('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send your message');
    } finally {
      setBusy(false);
    }
  }

  if (error && !t) return <Notice tone="error">{error}</Notice>;
  if (!t) return <Loading />;

  return (
    <article className="thread">
      <header className="thread-head">
        <div>
          <h2>{t.subject}</h2>
          <p className="muted">{t.bookTitle ?? 'General or account level'}, opened {fmtDateTime(t.createdAt)}</p>
        </div>
        <StatusPill status={t.status} />
      </header>

      {justCreated && <Notice>Your query is with us. Replies appear in this thread by themselves, so you can leave this page open or come back later.</Notice>}

      <div className="msg msg-author">
        <div className="msg-who">You, {fmtDateTime(t.createdAt)}</div>
        <p className="read">{t.description}</p>
        {t.attachments.length > 0 && <p className="muted small">Files listed: {t.attachments.map((a) => a.name).join(', ')}</p>}
      </div>

      {t.messages.length === 0 && (
        <p className="muted waiting">No reply yet. Most queries get a first response within one working day.</p>
      )}

      {t.messages.map((m) => (
        <div key={m.id} className={`msg msg-${m.role} ${fresh.has(m.id) ? 'fresh' : ''}`}>
          <div className="msg-who">{m.role === 'admin' ? `BookLeaf, ${m.senderName.split(' ')[0]}` : 'You'}, {fmtDateTime(m.createdAt)}</div>
          <p className="read">{m.body}</p>
        </div>
      ))}

      {t.status === 'Closed' ? (
        <Notice>This query is closed. <Link to="/query/new">Raise a new one</Link> if you need more help.</Notice>
      ) : (
        <form className="replybox" onSubmit={send}>
          {error && <Notice tone="error">{error}</Notice>}
          <label className="field">
            <span>{t.status === 'Resolved' ? 'Not sorted? Reply to reopen this query' : 'Add to this thread'}</span>
            <textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} />
          </label>
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy || !reply.trim()}>{busy ? 'Sending' : 'Send'}</button>
          </div>
        </form>
      )}
    </article>
  );
}

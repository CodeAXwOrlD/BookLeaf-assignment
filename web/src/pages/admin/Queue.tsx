import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { ageLabel } from '../../format';
import { CATEGORIES, PRIORITIES, STATUSES, type AdminTicketSummary, type Stats } from '../../types';
import { Empty, Loading, Notice, PriorityInk, StatusPill } from '../../ui/Marks';
import { useLiveEvents } from '../liveContext';

interface Filters {
  status: string; category: string; priority: string; assignee: string;
  from: string; to: string; q: string; sort: string; page: number;
}
const DEFAULTS: Filters = { status: 'active', category: '', priority: '', assignee: '', from: '', to: '', q: '', sort: 'urgency', page: 1 };
const PAGE_SIZE = 25;

export function Queue() {
  const nav = useNavigate();
  const [f, setF] = useState<Filters>(DEFAULTS);
  const [data, setData] = useState<{ total: number; tickets: AdminTicketSummary[] } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Set<number>>(new Set());
  const fRef = useRef(f);
  fRef.current = f;

  const load = useCallback(async () => {
    const cur = fRef.current;
    try {
      const [list, s] = await Promise.all([
        api.adminTickets({
          status: cur.status === 'active' ? ['Open', 'In Progress'] : cur.status === 'all' ? undefined : cur.status,
          category: cur.category, priority: cur.priority, assignee: cur.assignee || undefined,
          from: cur.from, to: cur.to, q: cur.q, sort: cur.sort, page: cur.page, pageSize: PAGE_SIZE,
        }),
        api.adminStats(),
      ]);
      setData(list);
      setStats(s);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the queue');
    }
  }, []);

  // Refetch on filter change; debounce free-text search.
  useEffect(() => {
    const t = setTimeout(load, f.q ? 250 : 0);
    return () => clearTimeout(t);
  }, [f, load]);

  useLiveEvents((e) => {
    load();
    if (e.type === 'ticket.created') {
      setFlash((s) => new Set(s).add(e.ticketId));
      setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(e.ticketId); return n; }), 3000);
    }
  });

  const set = (patch: Partial<Filters>) => setF((p) => ({ ...p, page: 1, ...patch }));

  return (
    <div className="queue">
      <header className="pagehead pagehead-row">
        <div>
          <h1>Support queue</h1>
          <p>Unresolved tickets come first, then by priority, then oldest.</p>
        </div>
      </header>

      {stats && <StatsStrip stats={stats} onPick={set} />}
      {stats && <AiLine stats={stats} />}

      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label="Filter tickets">
        <label className="field field-search"><span>Search</span>
          <input value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Subject, author, book or ticket number" /></label>
        <label className="field"><span>Status</span>
          <select value={f.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="active">Open and in progress</option><option value="all">All</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select></label>
        <label className="field"><span>Category</span>
          <select value={f.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">All categories</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select></label>
        <label className="field"><span>Priority</span>
          <select value={f.priority} onChange={(e) => set({ priority: e.target.value })}>
            <option value="">Any</option>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select></label>
        <label className="field"><span>Assigned to</span>
          <select value={f.assignee} onChange={(e) => set({ assignee: e.target.value })}>
            <option value="">Anyone</option><option value="me">Me</option><option value="unassigned">Nobody</option>
          </select></label>
        <label className="field"><span>Opened from</span><input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="field"><span>Opened to</span><input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></label>
        <label className="field"><span>Sort</span>
          <select value={f.sort} onChange={(e) => set({ sort: e.target.value })}>
            <option value="urgency">Most urgent</option><option value="oldest">Oldest first</option><option value="newest">Newest first</option>
          </select></label>
        <button type="button" className="linklike" onClick={() => setF(DEFAULTS)}>Clear filters</button>
      </form>

      {error && <Notice tone="error">{error}</Notice>}
      {!data ? <Loading label="Loading the queue" /> : data.tickets.length === 0 ? (
        <Empty title="Nothing matches these filters">Try clearing a filter, or widen the dates.</Empty>
      ) : (
        <>
          <div className="tablewrap">
            <table className="qtable">
              <thead>
                <tr><th>Priority</th><th>Ticket</th><th>Category</th><th>Status</th><th className="r">Age</th><th>Assigned</th></tr>
              </thead>
              <tbody>
                {data.tickets.map((t) => (
                  <tr key={t.id} className={`${t.overdue ? 'is-overdue' : ''} ${flash.has(t.id) ? 'fresh' : ''}`} onClick={() => nav(`/admin/tickets/${t.id}`)}>
                    <td><PriorityInk priority={t.priority} />{t.priorityOverridden && <small className="edited" title={`AI suggested ${t.aiPriority}`}>edited</small>}</td>
                    <td className="q-subject">
                      <Link to={`/admin/tickets/${t.id}`} className={t.awaitingReply ? 'strong' : ''}>{t.subject}</Link>
                      <small>#{t.id}, {t.authorName}{t.bookTitle ? `, ${t.bookTitle}` : ''}</small>
                    </td>
                    <td>
                      {t.category}
                      {t.aiStatus === 'pending' ? <small className="edited">sorting</small> : t.categoryOverridden ? <small className="edited" title={`AI suggested ${t.aiCategory}`}>edited</small> : null}
                    </td>
                    <td><StatusPill status={t.status} />{t.awaitingReply && <small className="awaiting">needs reply</small>}</td>
                    <td className={`r num ${t.overdue ? 'overdue-text' : ''}`}>{ageLabel(t.ageHours)}{t.overdue && <small>overdue</small>}</td>
                    <td>{t.assigneeName ?? <span className="muted">Nobody</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer className="pager">
            <span className="muted">{data.total} {data.total === 1 ? 'ticket' : 'tickets'}</span>
            {data.total > PAGE_SIZE && (
              <span>
                <button className="linklike" disabled={f.page === 1} onClick={() => setF({ ...f, page: f.page - 1 })}>Previous</button>
                <span className="muted"> page {f.page} of {Math.ceil(data.total / PAGE_SIZE)} </span>
                <button className="linklike" disabled={f.page * PAGE_SIZE >= data.total} onClick={() => setF({ ...f, page: f.page + 1 })}>Next</button>
              </span>
            )}
          </footer>
        </>
      )}
    </div>
  );
}

function StatsStrip({ stats, onPick }: { stats: Stats; onPick: (p: Partial<Filters>) => void }) {
  const t = stats.tickets;
  const items: { label: string; value: number; tone?: string; pick: Partial<Filters> }[] = [
    { label: 'Open', value: t.open, pick: { status: 'Open', priority: '', assignee: '' } },
    { label: 'In progress', value: t.inProgress, pick: { status: 'In Progress', priority: '', assignee: '' } },
    { label: 'Critical', value: t.critical, tone: 'magenta', pick: { status: 'active', priority: 'Critical', assignee: '' } },
    { label: 'Overdue', value: t.overdue, tone: t.overdue ? 'magenta' : undefined, pick: { status: 'active', sort: 'oldest', priority: '', assignee: '' } },
    { label: 'Unassigned', value: t.unassigned, pick: { status: 'active', assignee: 'unassigned', priority: '' } },
  ];
  return (
    <section className="stats" aria-label="Queue summary">
      {items.map((i) => (
        <button key={i.label} className={`stat ${i.tone ? `stat-${i.tone}` : ''}`} onClick={() => onPick(i.pick)}>
          <b className="num">{i.value}</b>
          <span>{i.label}</span>
        </button>
      ))}
    </section>
  );
}

function AiLine({ stats }: { stats: Stats }) {
  const a = stats.ai;
  if (!a.providersConfigured.length || a.enabled === false) {
    return (
      <Notice tone="warn">
        {a.enabled === false ? 'AI kill switch is active (LLM_ENABLED=false).' : 'No AI key is configured.'}{' '}
        Tickets are sorted with keyword rules and reply drafts start from templates.
      </Notice>
    );
  }
  const tokens = a.last24h.promptTokens + a.last24h.completionTokens;
  return (
    <p className="ailine muted">
      {a.dailyCap !== undefined && a.todayCalls !== undefined && (
        <span style={{ fontWeight: 600, color: 'var(--key)' }}>AI calls today: {a.todayCalls} / {a.dailyCap}. </span>
      )}
      AI via {a.providersConfigured.join(' then ')}. Last 24 hours: {a.last24h.calls} calls, {tokens.toLocaleString('en-IN')} tokens
      {a.last24h.failures ? `, ${a.last24h.failures} failed (fallbacks covered them)` : ''}.
      Admins changed {Math.round(a.categoryOverrideRate * 100)}% of categories and {Math.round(a.priorityOverrideRate * 100)}% of priorities.
    </p>
  );
}

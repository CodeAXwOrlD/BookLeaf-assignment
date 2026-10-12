import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { ago, fmtDate, fmtDateTime, inr } from '../../format';
import { CATEGORIES, PRIORITIES, STATUSES, type AdminTicketDetail, type BookFacts, type Draft, type TicketEvent } from '../../types';
import { Icon } from '../../ui/Icon';
import { Empty, Loading, Notice, PriorityInk, StatusPill } from '../../ui/Marks';
import { useLiveEvents } from '../liveContext';
import { useAuth } from '../../auth';

type Loaded = { ticket: AdminTicketDetail; facts: { asOf: string; focusBookId: string | null; books: BookFacts[] } };

export function TicketDetail() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const [admins, setAdmins] = useState<{ id: number; name: string; email: string }[]>([]);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const known = useRef<Set<number> | null>(null);

  const [tab, setTab] = useState<'reply' | 'note'>('reply');
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftLoading, setDraftLoading] = useState(true);
  const [draftApplied, setDraftApplied] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const touched = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await api.adminTicket(id);
      const ids = new Set(d.ticket.messages.map((m) => m.id));
      if (known.current) {
        const added = [...ids].filter((x) => !known.current!.has(x));
        if (added.length) {
          setFresh(new Set(added));
          setTimeout(() => setFresh(new Set()), 2600);
        }
      }
      known.current = ids;
      setData(d);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(e instanceof ApiError ? e.message : 'Could not load this ticket');
    }
  }, [id]);

  const loadDraft = useCallback(async () => {
    setDraftLoading(true);
    try {
      const { draft: d } = await api.getDraft(id);
      setDraft(d);
      if (!touched.current) {
        setReply(d.body);
        setDraftApplied(true);
      }
    } catch {
      setDraft(null);
    } finally {
      setDraftLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
    loadDraft();
    api.adminAdmins().then((r) => setAdmins(r.admins)).catch(() => {});
  }, [load, loadDraft]);
  useLiveEvents((e) => { if (e.ticketId === id || e.type === 'resync') load(); });

  async function patch(p: Record<string, unknown>) {
    setError(null);
    try { await api.patchTicket(id, p); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Update failed'); }
  }

  async function regenerate() {
    if (touched.current && reply.trim() && !window.confirm('Replace what you have typed with a new draft?')) return;
    setDraftLoading(true);
    setError(null);
    try {
      const { draft: d } = await api.regenerateDraft(id, instruction || undefined);
      setDraft(d);
      setReply(d.body);
      setDraftApplied(true);
      touched.current = false;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not regenerate the draft');
    } finally {
      setDraftLoading(false);
    }
  }

  async function send(status?: string) {
    setBusy(true);
    setError(null);
    try {
      await api.adminReply(id, { body: reply, usedDraft: draftApplied, status });
      setReply('');
      setDraftApplied(false);
      touched.current = true;
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the reply');
    } finally { setBusy(false); }
  }

  async function addNote() {
    setBusy(true);
    try { await api.addNote(id, note); setNote(''); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save the note'); }
    finally { setBusy(false); }
  }

  if (notFound) return <Empty title="Ticket not found"><Link to="/admin">Back to the queue</Link></Empty>;
  if (!data) return error ? <Notice tone="error">{error}</Notice> : <Loading label="Opening ticket" />;

  const { ticket: t, facts } = data;
  const mine = t.assigneeId === user?.id;
  const lastVisible = [...t.messages].reverse().find((m) => !m.internal);
  const authorRepliedSinceDraft = !!draft && lastVisible?.role === 'author' && new Date(lastVisible.createdAt) > new Date(draft.generatedAt);
  const closed = t.status === 'Closed';

  return (
    <div className="detail">
      <Link to="/admin" className="back">Back to the queue</Link>
      <div className="detail-grid">
        <section className="detail-main">
          <header className="thread-head">
            <div>
              <h1 className="h-ticket">{t.subject}</h1>
              <p className="muted">
                #{t.id}, {t.authorName}{t.bookTitle ? `, ${t.bookTitle}` : ', account level'}, opened {ago(t.createdAt)}
                {t.resolvedAt ? `, resolved ${ago(t.resolvedAt)}` : ''}
              </p>
            </div>
            <StatusPill status={t.status} />
          </header>

          {error && <Notice tone="error">{error}</Notice>}

          <div className="msg msg-author">
            <div className="msg-who">{t.authorName}, {fmtDateTime(t.createdAt)}</div>
            <p className="read">{t.description}</p>
            {t.attachments.length > 0 && <p className="muted small">Files listed: {t.attachments.map((a) => a.name).join(', ')}</p>}
          </div>

          {t.messages.map((m) => (
            <div key={m.id} className={`msg ${m.internal ? 'msg-internal' : `msg-${m.role}`} ${fresh.has(m.id) ? 'fresh' : ''}`}>
              <div className="msg-who">
                {m.internal && <Icon name="lock" size={13} />} {m.role === 'admin' ? m.senderName : t.authorName}, {fmtDateTime(m.createdAt)}
                {m.internal && <b className="internal-tag">Internal note. The author cannot see this.</b>}
                {m.aiDraftUsed && <b className="internal-tag">Sent from AI draft</b>}
              </div>
              <p className="read">{m.body}</p>
            </div>
          ))}

          {closed ? (
            <Notice>This ticket is closed. Set the status back to In Progress to reply.</Notice>
          ) : (
            <div className="composer">
              <div className="tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'reply'} onClick={() => setTab('reply')}>Reply to author</button>
                <button role="tab" aria-selected={tab === 'note'} onClick={() => setTab('note')}>Internal note</button>
              </div>

              {tab === 'reply' ? (
                <div className="composer-body">
                  <DraftBanner draft={draft} loading={draftLoading} stale={authorRepliedSinceDraft} onRegenerate={regenerate} />
                  <textarea
                    rows={12} value={reply} placeholder={draftLoading ? 'Drafting a reply from the knowledge base' : 'Write your reply'}
                    onChange={(e) => { touched.current = true; setReply(e.target.value); }} aria-label="Reply to the author"
                  />
                  <div className="steer">
                    <input value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={300}
                      placeholder="Steer the next draft, for example: shorter, offer a call, mention the reprint" aria-label="Instruction for regenerating the draft" />
                    <button className="btn btn-quiet" onClick={regenerate} disabled={draftLoading}><Icon name="refresh" /> Redraft</button>
                  </div>
                  <div className="form-actions">
                    <button className="btn btn-primary" disabled={busy || !reply.trim()} onClick={() => send()}><Icon name="send" /> Send reply</button>
                    <button className="btn btn-quiet" disabled={busy || !reply.trim()} onClick={() => send('Resolved')}><Icon name="check" /> Send and resolve</button>
                  </div>
                </div>
              ) : (
                <div className="composer-body">
                  <textarea rows={5} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Internal note" placeholder="Visible to the BookLeaf team only" />
                  <div className="form-actions"><button className="btn btn-primary" disabled={busy || !note.trim()} onClick={addNote}>Save note</button></div>
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="detail-side">
          <section className="panel">
            <h2>Handling</h2>
            <label className="field"><span>Status</span>
              <select value={t.status} onChange={(e) => patch({ status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="field">
              <span>Assigned to</span>
              <select
                value={t.assigneeId ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  patch({ assignee: val === '' ? null : Number(val) });
                }}
              >
                <option value="">Unassigned</option>
                {admins.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} {a.id === user?.id ? '(You)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {!mine && (
              <div style={{ marginTop: '0.35rem' }}>
                <button className="btn btn-quiet" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }} onClick={() => patch({ assignee: 'me' })}>
                  Assign to me
                </button>
              </div>
            )}
          </section>

          <section className="panel">
            <h2>AI triage</h2>
            <label className="field"><span>Category</span>
              <select value={t.category} onChange={(e) => patch({ category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
            {t.categoryOverridden && t.aiCategory && (
              <p className="small muted">AI suggested {t.aiCategory}. <button className="linklike" onClick={() => patch({ category: t.aiCategory })}>Use it</button></p>
            )}
            <label className="field"><span>Priority</span>
              <select value={t.priority} onChange={(e) => patch({ priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></label>
            {t.priorityOverridden && t.aiPriority && (
              <p className="small muted">AI suggested {t.aiPriority}. <button className="linklike" onClick={() => patch({ priority: t.aiPriority })}>Use it</button></p>
            )}
            <p className="small"><PriorityInk priority={t.priority} /></p>
            {t.aiReasoning && <p className="small muted">Why: {t.aiReasoning}</p>}
            <p className="small muted">
              {t.aiStatus === 'llm' ? 'Sorted by the AI model.' : t.aiStatus === 'rules' ? 'Sorted by keyword rules (AI was unavailable or off).' : 'Still being sorted.'}{' '}
              <button className="linklike" onClick={async () => { await api.reclassify(id); setTimeout(load, 1800); }}>Run again</button>
            </p>
          </section>

          <FactsPanel facts={facts} />
          <Timeline events={t.events} />
        </aside>
      </div>
    </div>
  );
}

function DraftBanner({ draft, loading, stale, onRegenerate }: { draft: Draft | null; loading: boolean; stale: boolean; onRegenerate: () => void }) {
  if (loading) return <div className="draftbar"><span className="press-line" />Drafting a reply from the knowledge base and this author's records</div>;
  if (!draft) return <Notice tone="warn">Could not prepare a draft. Write the reply yourself; nothing else is affected.</Notice>;
  return (
    <div className={`draftbar ${draft.source === 'template' ? 'draftbar-template' : ''}`}>
      {draft.source === 'llm'
        ? <span>Drafted by {draft.provider} ({draft.model}). Check the facts, edit freely, then send.</span>
        : <span>Template draft{draft.fallbackReason ? `: ${draft.fallbackReason}` : ''}. Built from the policy and this author's records, so the numbers are right.</span>}
      {stale && <span className="stale">The author replied after this draft. <button className="linklike" onClick={onRegenerate}>Redraft</button></span>}
    </div>
  );
}

function FactsPanel({ facts }: { facts: Loaded['facts'] }) {
  const focus = facts.books.find((b) => b.bookId === facts.focusBookId);
  const books = focus ? [focus] : facts.books;
  return (
    <section className="panel">
      <h2>{focus ? 'Book on record' : "Author's books"}</h2>
      {books.map((b) => (
        <div key={b.bookId} className="factbook">
          <b>{b.title}</b>
          <span className="muted small">{b.status}</span>
          {b.isPublished ? (
            <>
              <dl className="mini">
                <div><dt>Sold</dt><dd className="num">{b.copiesSold}</dd></div>
                <div><dt>Earned</dt><dd className="num">{inr(b.earned)}</dd></div>
                <div><dt>Paid</dt><dd className="num">{inr(b.paid)}</dd></div>
                <div><dt>Pending</dt><dd className="num">{inr(b.pending)}</dd></div>
                <div><dt>Last payout</dt><dd>{b.lastPayoutDate ? fmtDate(b.lastPayoutDate) : 'None'}</dd></div>
                <div><dt>Next due</dt><dd>{fmtDate(b.nextPayoutDue)}</dd></div>
              </dl>
              <p className={`small royalty-note royalty-${/overdue|missed/.test(b.royalty.note) ? 'late' : 'wait'}`}>{b.royalty.note}</p>
              <p className="small muted">Listed on {b.platforms.join(', ') || 'no platforms'}</p>
            </>
          ) : b.production ? (
            <p className="small">Stage {b.production.position} of {b.production.total}: {b.production.stage}</p>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function describe(e: TicketEvent): string {
  const d = e.detail ?? {};
  switch (e.type) {
    case 'created': return 'Opened by the author';
    case 'ai_triaged': return `Sorted as ${d.category}, ${d.priority}, by ${d.source === 'llm' ? 'the AI model' : 'keyword rules'}`;
    case 'status_changed': return `Status ${d.from} to ${d.to}`;
    case 'category_changed': return `Category changed to ${d.to}`;
    case 'priority_changed': return `Priority ${d.from} to ${d.to}`;
    case 'assigned': return `Assigned to ${d.to}`;
    case 'unassigned': return 'Unassigned';
    case 'replied': return d.usedDraft ? 'Replied using the AI draft' : 'Replied';
    case 'reopened': return 'Reopened by the author';
    default: return e.type;
  }
}

function Timeline({ events }: { events: TicketEvent[] }) {
  return (
    <section className="panel">
      <h2>History</h2>
      <ul className="timeline">
        {events.map((e) => (
          <li key={e.id}>
            <span>{describe(e)}</span>
            <small className="muted">{e.actorName ? `${e.actorName}, ` : ''}{ago(e.createdAt)}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

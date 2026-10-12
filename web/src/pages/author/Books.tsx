import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { fmtDate, inr } from '../../format';
import { PRODUCTION_STAGES, type Book } from '../../types';
import { CountUp, Empty, Loading, Notice } from '../../ui/Marks';

/** Spine colour by shelf, using the four process inks. Unpublished books get a dashed, unprinted spine. */
function spineInk(b: Book): string {
  if (!b.isPublished) return 'proof';
  const g = (b.genre ?? '').toLowerCase();
  if (/poetry|romance|humou?r/.test(g)) return 'magenta';
  if (/self-help|business|technology/.test(g)) return 'yellow';
  if (/non-fiction|memoir|travel|parenting|essays/.test(g)) return 'cyan';
  return 'leaf';
}
const spineHeight = (id: string) => 214 + (id.split('').reduce((n, c) => n + c.charCodeAt(0), 0) % 5) * 9;

function royaltyMessage(b: Book): { tone: 'ok' | 'wait' | 'late'; text: string; ask: boolean } | null {
  const r = b.royaltyStatus;
  switch (r.code) {
    case 'never_paid_overdue':
      return { tone: 'late', ask: true, text: `Your first payout of ${inr(b.royaltyPending)} was due by ${fmtDate(r.dueBy)}. That is on us. Tell us and we'll come back within 48 hours.` };
    case 'stale_since_last_payout':
      return { tone: 'late', ask: true, text: `Your last payout was on ${fmtDate(b.lastPayoutDate)}. Payouts run every quarter, so another may be due. Ask us to check it.` };
    case 'below_threshold':
      return { tone: 'wait', ask: false, text: `${inr(b.royaltyPending)} is under our ${inr(1000)} minimum, so it rolls over to next quarter. Nothing is late.` };
    case 'first_payout_due':
    case 'in_cycle':
      return { tone: 'wait', ask: false, text: `Next payout is due by ${fmtDate(r.dueBy ?? b.nextPayoutDue)}.` };
    case 'settled':
      return { tone: 'ok', ask: false, text: 'Everything you have earned has been paid.' };
    case 'no_sales':
      return { tone: 'wait', ask: false, text: 'No copies sold yet, so there is no royalty so far.' };
    default:
      return null;
  }
}

export function Books() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('book');

  useEffect(() => {
    api.books().then((r) => setBooks(r.books)).catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load your books'));
  }, []);

  const selected = useMemo(() => books?.find((b) => b.bookId === selectedId) ?? books?.[0] ?? null, [books, selectedId]);
  const totals = useMemo(() => {
    const pub = (books ?? []).filter((b) => b.isPublished);
    return {
      earned: pub.reduce((n, b) => n + b.royaltyEarned, 0),
      paid: pub.reduce((n, b) => n + b.royaltyPaid, 0),
      pending: pub.reduce((n, b) => n + b.royaltyPending, 0),
      published: pub.length,
    };
  }, [books]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!books) return <Loading label="Fetching your books" />;
  if (!books.length) return <Empty title="No books on your account yet">Once your manuscript is received, it will appear here with its production stage.</Empty>;

  return (
    <div className="books">
      <header className="pagehead">
        <div className="pagehead-meta">
          <span className="badge badge-leaf">Author Dashboard</span>
          <span className="pagehead-date">{totals.published} of {books.length} titles published</span>
        </div>
        <h1>Your books & royalties</h1>
        <p>Complete sales records, quarterly payout cycles, and active production stages.</p>
      </header>

      {totals.published > 0 && (
        <section className="ledger-grid" aria-label="Royalty totals across your published books">
          <div className="ledger-card">
            <div className="ledger-head">
              <span className="ledger-label">Total Royalty Earned</span>
              <span className="ledger-badge">All-time</span>
            </div>
            <div className="ledger-value">
              <CountUp value={totals.earned} format={inr} />
            </div>
            <span className="ledger-sub">From {books.reduce((s, b) => s + b.copiesSold, 0).toLocaleString('en-IN')} copies sold</span>
          </div>

          <div className="ledger-card">
            <div className="ledger-head">
              <span className="ledger-label">Paid to You</span>
              <span className="ledger-badge ledger-badge-paid">Transferred</span>
            </div>
            <div className="ledger-value">
              <CountUp value={totals.paid} format={inr} />
            </div>
            <span className="ledger-sub">Settled to your verified bank account</span>
          </div>

          <div className={`ledger-card ledger-card-pending ${totals.pending > 0 ? 'has-pending' : ''}`}>
            <div className="ledger-head">
              <span className="ledger-label">Pending Payout</span>
              <span className={`ledger-badge ${totals.pending >= 1000 ? 'ledger-badge-due' : 'ledger-badge-roll'}`}>
                {totals.pending >= 1000 ? 'Payable' : 'Rollover'}
              </span>
            </div>
            <div className="ledger-value">
              <CountUp value={totals.pending} format={inr} />
            </div>
            <span className="ledger-sub">
              {totals.pending >= 1000 ? 'Scheduled for upcoming quarter payout' : 'Under ₹1,000 threshold (rolls over)'}
            </span>
          </div>
        </section>
      )}

      <div className="shelf-container">
        <div className="shelf-header">
          <span className="shelf-title">Library Shelf</span>
          <span className="shelf-hint">Select a title to view publication facts & royalty status</span>
        </div>
        <div className="shelf" role="group" aria-label="Your books. Choose one to see its details.">
          {books.map((b) => (
            <button
              key={b.bookId}
              className={`spine spine-${spineInk(b)} ${selected?.bookId === b.bookId ? 'is-selected' : ''}`}
              style={{ height: spineHeight(b.bookId) }}
              aria-pressed={selected?.bookId === b.bookId}
              onClick={() => setParams({ book: b.bookId }, { replace: true })}
            >
              <div className="spine-rib spine-rib-top" />
              <div className="spine-content">
                <span className="spine-title">{b.title}</span>
                <span className="spine-id">{b.bookId}</span>
              </div>
              <div className="spine-rib spine-rib-bottom" />
            </button>
          ))}
          <div className="shelf-bookend" aria-hidden="true">
            <div className="bookend-brace" />
            <div className="bookend-label">BookLeaf</div>
          </div>
          <div className="shelf-board" />
        </div>
      </div>

      {selected && <BookSheet key={selected.bookId} book={selected} />}
    </div>
  );
}

function BookSheet({ book: b }: { book: Book }) {
  const msg = royaltyMessage(b);
  const ask = `/query/new?book=${b.bookId}`;

  return (
    <article className="sheet bookdetail">
      <div className="bookdetail-main">
        <div className="bookdetail-header">
          <div>
            <h2>{b.title}</h2>
            <div className="bookdetail-tags">
              <span className="tag-genre">{b.genre ?? 'General'}</span>
              <span className={`tag-status ${b.isPublished ? 'tag-status-live' : 'tag-status-prod'}`}>
                {b.isPublished ? '● Published & Live' : '◌ In Production'}
              </span>
            </div>
          </div>
        </div>

        {b.isPublished ? (
          <dl className="facts">
            <div><dt>Status</dt><dd>{b.status}</dd></div>
            <div><dt>ISBN</dt><dd className="num code-chip">{b.isbn}</dd></div>
            <div><dt>Published</dt><dd>{fmtDate(b.publicationDate)}</dd></div>
            <div><dt>MRP</dt><dd className="num">{inr(b.mrp)}</dd></div>
            <div><dt>Copies sold</dt><dd className="num">{b.copiesSold.toLocaleString('en-IN')}</dd></div>
            <div><dt>Printed by</dt><dd>{b.printPartner ?? 'In-House (Delhi)'}</dd></div>
            <div className="facts-wide">
              <dt>Distribution channels</dt>
              <dd className="platform-pills">
                {b.platforms.length
                  ? b.platforms.map((p) => <span key={p} className="platform-pill">{p}</span>)
                  : <span className="muted">No platforms recorded yet</span>}
              </dd>
            </div>
          </dl>
        ) : (
          <Production book={b} />
        )}
      </div>

      <aside className="bookdetail-money" aria-label="Royalties for this book">
        {b.isPublished ? (
          <>
            <div className="royalty-summary-card">
              <span className="card-caption">Financial breakdown</span>
              <table className="ledger-table">
                <tbody>
                  <tr><th scope="row">Royalty earned</th><td><CountUp value={b.royaltyEarned} format={inr} /></td></tr>
                  <tr><th scope="row">Paid to you</th><td><CountUp value={b.royaltyPaid} format={(n) => `− ${inr(n)}`} /></td></tr>
                  <tr className="total"><th scope="row">Pending payout</th><td><CountUp value={b.royaltyPending} format={inr} /></td></tr>
                </tbody>
              </table>
            </div>

            <div className="royalty-meta">
              <span>{b.royaltyPerCopy ? `${inr(b.royaltyPerCopy)} per copy.` : ''}</span>
              <span>{b.lastPayoutDate ? `Last payout on ${fmtDate(b.lastPayoutDate)}.` : 'No previous payout.'}</span>
            </div>

            {msg && (
              <div className={`royalty-note royalty-${msg.tone}`}>
                <p>{msg.text}</p>
                {msg.ask && <Link className="btn btn-quiet" to={`${ask}&topic=royalty`}>Ask about this payout</Link>}
              </div>
            )}
          </>
        ) : (
          <div className="production-note">
            <p>Royalties begin accumulating as soon as distribution channels go live. Payouts run every quarter, within 45 days of the quarter ending.</p>
          </div>
        )}
        <div style={{ marginTop: '1.2rem' }}>
          <Link className="btn btn-primary btn-block" to={ask}>
            Raise a query about this book
          </Link>
        </div>
      </aside>
    </article>
  );
}

function Production({ book: b }: { book: Book }) {
  const pos = b.production?.position ?? 0;
  return (
    <div className="production">
      <p>
        {b.production
          ? `Now at ${b.production.stage}, stage ${pos} of ${b.production.total}. We email you at every stage.`
          : b.status}
      </p>
      <ol className="stages" aria-label="Production stages">
        {PRODUCTION_STAGES.map((s, i) => (
          <li key={s} className={i + 1 < pos ? 'done' : i + 1 === pos ? 'now' : ''} aria-current={i + 1 === pos ? 'step' : undefined}>
            <i />
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <p className="muted small">Delays most often happen at Cover Design, while we wait for your approval, and at Proofreading, during revision rounds.</p>
    </div>
  );
}

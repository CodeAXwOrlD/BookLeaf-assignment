import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api';
import type { Book } from '../../types';
import { Icon } from '../../ui/Icon';
import { Loading, Notice } from '../../ui/Marks';

const MAX_FILES = 5;
const MAX_MB = 10;

export function NewTicket() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [books, setBooks] = useState<Book[] | null>(null);
  const [bookId, setBookId] = useState(params.get('book') ?? '');
  const [subject, setSubject] = useState(params.get('topic') === 'royalty' ? 'Question about my royalty payout' : '');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.books().then((r) => setBooks(r.books)).catch(() => setBooks([]));
  }, []);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > MAX_MB * 1024 * 1024) { setError(`${f.name} is over ${MAX_MB} MB.`); continue; }
      if (next.length < MAX_FILES) next.push(f);
    }
    setFiles(next);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const { ticket } = await api.createTicket({
        bookId: bookId || null,
        subject,
        description,
        attachments: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      });
      nav(`/tickets/${ticket.id}`, { state: { justCreated: true } });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(Object.fromEntries((err.details ?? []).map((d) => [d.field, d.message])));
      } else setError('Could not send your query');
    } finally {
      setBusy(false);
    }
  }

  if (!books) return <Loading />;

  return (
    <div className="newticket">
      <header className="pagehead">
        <h1>New query</h1>
        <p>Tell us what is going on. The more detail you give, the fewer questions we have to ask back.</p>
      </header>

      <form className="sheet form" onSubmit={submit} noValidate>
        {error && <Notice tone="error">{error}</Notice>}

        <label className="field">
          <span>Which book is this about?</span>
          <select value={bookId} onChange={(e) => setBookId(e.target.value)}>
            <option value="">General or account level</option>
            {books.map((b) => (
              <option key={b.bookId} value={b.bookId}>{b.title}{b.isPublished ? '' : ' (in production)'}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={140} placeholder="Short summary, like “No royalty received yet”" aria-invalid={!!fieldErrors.subject} />
          {fieldErrors.subject && <em className="field-error">{fieldErrors.subject}</em>}
        </label>

        <label className="field">
          <span>What happened?</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={8} maxLength={5000} aria-invalid={!!fieldErrors.description}
            placeholder="Include dates, platform names, amounts, anything you have already tried." />
          <small className="counter">{description.length} of 5000</small>
          {fieldErrors.description && <em className="field-error">{fieldErrors.description}</em>}
        </label>

        <div className="field">
          <span>Attachments (optional)</span>
          <div className="attach">
            <button type="button" className="btn btn-quiet" onClick={() => fileRef.current?.click()} disabled={files.length >= MAX_FILES}>
              <Icon name="clip" /> Add files
            </button>
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            <small className="muted">Up to {MAX_FILES} files, {MAX_MB} MB each. Photos of printing problems help most.</small>
          </div>
          {files.length > 0 && (
            <ul className="filelist">
              {files.map((f, i) => (
                <li key={f.name + i}>
                  <span>{f.name}</span>
                  <small className="muted">{(f.size / 1024).toFixed(0)} KB</small>
                  <button type="button" className="iconbtn" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
                </li>
              ))}
            </ul>
          )}
          {files.length > 0 && <small className="muted">File upload is not switched on yet. Your query will list these files and we will ask you to email them.</small>}
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending' : 'Send query'}</button>
        </div>
      </form>
    </div>
  );
}

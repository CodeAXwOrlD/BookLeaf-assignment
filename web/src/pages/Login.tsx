import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import type { DemoAccounts } from '../types';
import { LeafMark, Plates } from '../ui/Plates';
import { Notice } from '../ui/Marks';

export function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<DemoAccounts | null>(null);

  useEffect(() => {
    api.demoAccounts().then(setDemo).catch(() => setDemo(null));
  }, []);

  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/books'} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      nav(u.role === 'admin' ? '/admin' : '/books', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  function pick(value: string) {
    const acct = demo?.accounts.find((a) => a.email === value);
    if (!acct || !demo) return;
    setEmail(acct.email);
    setPassword(acct.role === 'admin' ? demo.adminPassword ?? '' : demo.authorPassword ?? '');
  }

  const authors = demo?.accounts.filter((a) => a.role === 'author') ?? [];
  const admins = demo?.accounts.filter((a) => a.role === 'admin') ?? [];

  return (
    <div className="login">
      <section className="login-hero">
        <div className="hero-inner">
          <div className="hero-topbar">
            <div className="brand brand-lg">
              <LeafMark size={28} />
              <span>BookLeaf</span>
            </div>
            <div className="hero-pill">
              <span className="hero-pill-dot" />
              Author & Ops Desk
            </div>
          </div>

          <div className="plates-stage">
            <Plates />
            <div className="plates-caption">
              <span>CMYK Process Registration</span>
              <span className="plates-sub">In register • Leaf Brandmark</span>
            </div>
          </div>

          <h1>Ask about your book. We answer with your numbers open in front of us.</h1>
          <p className="lede">Royalties, ISBNs, print runs, listings, production stages. One desk for all of it.</p>

          <div className="hero-features">
            <div className="hero-feature">
              <span className="feature-icon">⚡</span>
              <span>Real-time live updates</span>
            </div>
            <div className="hero-feature">
              <span className="feature-icon">📊</span>
              <span>Transparent royalty ledger</span>
            </div>
            <div className="hero-feature">
              <span className="feature-icon">🛡️</span>
              <span>48h SLA response guarantee</span>
            </div>
          </div>
        </div>
      </section>

      <section className="login-sheet" aria-labelledby="signin-title">
        <div className="login-card">
          <div className="login-header">
            <h2 id="signin-title">Sign in</h2>
            <p className="login-subtitle">Welcome back. Enter your credentials to continue.</p>
          </div>

          <form onSubmit={submit} noValidate>
            {error && <Notice tone="error">{error}</Notice>}
            <label className="field">
              <span>Email address</span>
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@email.com" />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
            </label>
            <button className="btn btn-primary btn-block" disabled={busy || !email || !password}>
              {busy ? 'Signing in…' : 'Sign in to portal'}
            </button>
          </form>

          {demo?.enabled && (
            <div className="demo">
              <div className="demo-head">
                <h3>One-click demo personas</h3>
                <span className="demo-tag">Auto-fills credentials</span>
              </div>
              <p className="demo-desc">Click any account below to explore real author or admin scenarios:</p>

              <div className="demo-group">
                <span className="demo-group-label">Authors (Edge cases pre-configured)</span>
                <div className="demo-chips">
                  <button type="button" className={`demo-chip ${email === 'ananya.reddy@email.com' ? 'active' : ''}`} onClick={() => pick('ananya.reddy@email.com')}>
                    <span className="chip-name">Ananya Reddy</span>
                    <span className="chip-badge chip-badge-late">Overdue</span>
                  </button>
                  <button type="button" className={`demo-chip ${email === 'kavita.deshmukh@email.com' ? 'active' : ''}`} onClick={() => pick('kavita.deshmukh@email.com')}>
                    <span className="chip-name">Kavita Deshmukh</span>
                    <span className="chip-badge chip-badge-wait">Rollover</span>
                  </button>
                  <button type="button" className={`demo-chip ${email === 'sneha.kulkarni@email.com' ? 'active' : ''}`} onClick={() => pick('sneha.kulkarni@email.com')}>
                    <span className="chip-name">Sneha Kulkarni</span>
                    <span className="chip-badge chip-badge-prod">In Production</span>
                  </button>
                  <button type="button" className={`demo-chip ${email === 'priya.sharma@email.com' ? 'active' : ''}`} onClick={() => pick('priya.sharma@email.com')}>
                    <span className="chip-name">Priya Sharma</span>
                    <span className="chip-badge chip-badge-ok">Published</span>
                  </button>
                </div>
              </div>

              <div className="demo-group">
                <span className="demo-group-label">Operations team</span>
                <div className="demo-chips">
                  <button type="button" className={`demo-chip demo-chip-admin ${email === 'admin@bookleaf.in' ? 'active' : ''}`} onClick={() => pick('admin@bookleaf.in')}>
                    <span className="chip-name">Aarav Menon</span>
                    <span className="chip-badge chip-badge-admin">Lead Admin</span>
                  </button>
                  <button type="button" className={`demo-chip demo-chip-admin ${email === 'ops@bookleaf.in' ? 'active' : ''}`} onClick={() => pick('ops@bookleaf.in')}>
                    <span className="chip-name">Ishita Rao</span>
                    <span className="chip-badge chip-badge-admin">Ops Admin</span>
                  </button>
                </div>
              </div>

              <details className="demo-all">
                <summary>View all 10 authors</summary>
                <div className="demo-select-wrap">
                  <select value="" onChange={(e) => pick(e.target.value)} aria-label="Select author">
                    <option value="">Select an author to auto-fill…</option>
                    {authors.map((a) => (
                      <option key={a.email} value={a.email}>{a.name} ({a.email})</option>
                    ))}
                  </select>
                </div>
              </details>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

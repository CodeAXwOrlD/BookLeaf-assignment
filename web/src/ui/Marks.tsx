import { useEffect, useRef, useState } from 'react';
import type { Priority, Status } from '../types';

export function StatusPill({ status }: { status: Status }) {
  return <span className={`status status-${status.toLowerCase().replace(' ', '-')}`}>{status}</span>;
}

const INK: Record<Priority, string> = { Critical: 'magenta', High: 'yellow', Medium: 'cyan', Low: 'key' };

/** Priority as a printing ink swatch + word. Colour is never the only signal. */
export function PriorityInk({ priority }: { priority: Priority }) {
  return (
    <span className="ink">
      <i className={`ink-chip ink-${INK[priority]}`} />
      {priority}
    </span>
  );
}

/** Counts up when the value changes (answers an action: opening a book, loading totals). */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || value === from.current) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 700);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(a + (value - a) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="num">{format(shown)}</span>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: React.ReactNode }) {
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="press-line" />
      {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function LiveDot({ state }: { state: 'connecting' | 'live' | 'offline' }) {
  const label = state === 'live' ? 'Updates are live' : state === 'offline' ? 'Reconnecting' : 'Connecting';
  return (
    <span className={`livedot livedot-${state}`} title={label}>
      <i />
      {label}
    </span>
  );
}

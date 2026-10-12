import { useEffect, useRef, useState } from 'react';

export interface LiveEvent { type: string; ticketId: number }
export type LiveState = 'connecting' | 'live' | 'offline';

const TYPES = ['ticket.created', 'ticket.updated', 'message.created', 'note.created'];

/**
 * Subscribes to the server's SSE stream. EventSource reconnects on its own; every time the
 * connection (re)opens we emit a synthetic 'resync' so pages refetch anything they missed.
 */
export function useLive(handler: (e: LiveEvent) => void): LiveState {
  const ref = useRef(handler);
  ref.current = handler;
  const [state, setState] = useState<LiveState>('connecting');

  useEffect(() => {
    const es = new EventSource('/api/v1/stream');
    let opened = false;
    es.onopen = () => {
      setState('live');
      if (opened) ref.current({ type: 'resync', ticketId: 0 });
      opened = true;
    };
    es.onerror = () => setState('offline');
    for (const t of TYPES) {
      es.addEventListener(t, (ev) => {
        try {
          ref.current({ type: t, ticketId: JSON.parse((ev as MessageEvent).data).ticketId });
        } catch { /* ignore malformed frame */ }
      });
    }
    return () => es.close();
  }, []);

  return state;
}

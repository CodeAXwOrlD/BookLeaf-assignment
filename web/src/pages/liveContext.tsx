import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { LiveEvent } from '../live';

type Listener = (e: LiveEvent) => void;
interface Bus { emit: Listener; subscribe: (l: Listener) => () => void }

const Ctx = createContext<Bus | null>(null);

/**
 * One SSE connection per layout, fanned out to whichever page is mounted.
 * Pages subscribe with useLiveEvents(); the layout owns the EventSource.
 */
export const LiveContext = {
  Provider: Ctx.Provider,
  useListeners(): Bus {
    const set = useRef(new Set<Listener>());
    const emit = useCallback<Listener>((e) => set.current.forEach((l) => l(e)), []);
    const subscribe = useCallback((l: Listener) => {
      set.current.add(l);
      return () => void set.current.delete(l);
    }, []);
    return useMemo(() => ({ emit, subscribe }), [emit, subscribe]);
  },
};

export function useLiveEvents(handler: Listener) {
  const bus = useContext(Ctx);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => bus?.subscribe((e) => ref.current(e)), [bus]);
}

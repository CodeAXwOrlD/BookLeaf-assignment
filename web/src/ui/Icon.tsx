const P: Record<string, string> = {
  plus: 'M8 3v10M3 8h10',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  check: 'M3 8.5l3.2 3.2L13 4.8',
  refresh: 'M13 8a5 5 0 1 1-1.7-3.8M13 2.8V5.6H10.2',
  clip: 'M10.5 4.5L5.6 9.4a1.5 1.5 0 0 0 2.1 2.1l5-5a3 3 0 0 0-4.2-4.2L3.4 7.4a4.5 4.5 0 0 0 6.4 6.4l3-3',
  send: 'M2 7.6L14 2.4 10 13.6 7.7 9z',
  lock: 'M4.5 7V5.5a3.5 3.5 0 0 1 7 0V7M3.5 7h9v6.5h-9z',
  eye: 'M1.5 8s2.5-4.5 6.5-4.5 6.5 4.5 6.5 4.5-2.5 4.5-6.5 4.5S1.5 8 1.5 8z M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  eyeOff: 'M6.6 6.6a2 2 0 0 0 2.8 2.8 M1.5 8c.8-1.5 2-2.7 3.5-3.5 M10.9 4.6c1.5.7 2.6 1.9 3.6 3.4-1.5 3.5-4 4.5-6.5 4.5-1.4 0-2.7-.4-3.8-1.2 M2 2l12 12',
};

/** Hand-set 16px glyphs, square caps, 1.6 stroke. No icon library. */
export function Icon({ name, size = 16 }: { name: keyof typeof P; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}

const LEAF = 'M100 8C160 50 190 120 100 232 10 120 40 50 100 8Z';
const VEINS = 'M100 28V226M100 92L152 62M100 92L48 62M100 142L160 108M100 142L40 108M100 190L140 160M100 190L60 160';
const VIEW = '-30 -20 260 280';

/**
 * The one orchestrated moment in the product: a four-colour print run coming into register.
 * Cyan and yellow plates carry the leaf (they overprint to green), the key plate carries the
 * line work. They start misregistered, like a press that isn't dialled in, and snap into place.
 */
export function Plates() {
  return (
    <div className="plates" aria-hidden="true">
      <svg viewBox={VIEW} className="plate plate-cyan"><path d={LEAF} /></svg>
      <svg viewBox={VIEW} className="plate plate-yellow"><path d={LEAF} /></svg>
      <svg viewBox={VIEW} className="plate plate-key"><path d={VEINS} /></svg>
      <svg viewBox={VIEW} className="plate-marks">
        <g>
          <path d="M-28 -6V-20H-14M228 -20H214M228 -20V-6M-28 260V274M-28 274H-14M228 274H214M228 274V260" transform="translate(0,-6)" />
          <circle cx="238" cy="130" r="9" /><path d="M238 116V144M224 130H252" />
        </g>
      </svg>
    </div>
  );
}

export function LeafMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 200 240" aria-hidden="true" className="leafmark">
      <path d={LEAF} fill="currentColor" />
      <path d="M100 30V226M100 92L152 62M100 92L48 62M100 142L160 108M100 142L40 108" stroke="var(--sheet)" strokeWidth="9" fill="none" />
    </svg>
  );
}

/**
 * Fixed decorative layer: a few thin network lines and sparse, slow particles.
 * Purely visual (aria-hidden), cheap to render (one SVG, transform/opacity animations only).
 */
const particles = [
  { x: 8, y: 18, t: 9, d: 0 },
  { x: 22, y: 64, t: 11, d: 2 },
  { x: 35, y: 30, t: 8, d: 4 },
  { x: 48, y: 82, t: 12, d: 1 },
  { x: 61, y: 12, t: 10, d: 3 },
  { x: 72, y: 46, t: 9, d: 5 },
  { x: 84, y: 74, t: 13, d: 2.5 },
  { x: 92, y: 26, t: 10, d: 6 },
  { x: 55, y: 58, t: 11, d: 3.5 },
  { x: 15, y: 90, t: 12, d: 1.5 },
];

export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-[1] overflow-hidden">
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
        <g stroke="#168bff" strokeWidth="1" fill="none" opacity="0.22">
          <path d="M0 22 L28 30 L52 18 L78 26 L100 14" vectorEffect="non-scaling-stroke" />
          <path d="M0 70 L20 62 L44 74 L66 60 L100 72" vectorEffect="non-scaling-stroke" />
          <path d="M28 30 L44 74" vectorEffect="non-scaling-stroke" opacity="0.6" />
          <path d="M78 26 L66 60" vectorEffect="non-scaling-stroke" opacity="0.6" />
        </g>
        <g fill="#00d9ff" opacity="0.5">
          {[
            [28, 30],
            [52, 18],
            [78, 26],
            [20, 62],
            [44, 74],
            [66, 60],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="0.25" />
          ))}
        </g>
      </svg>
      {particles.map((p, i) => (
        <span
          key={i}
          className="particle absolute size-[3px] rounded-full bg-sky"
          style={{ left: `${p.x}%`, top: `${p.y}%`, "--t": `${p.t}s`, "--d": `${p.d}s` } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

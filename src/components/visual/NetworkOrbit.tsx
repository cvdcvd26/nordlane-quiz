import { content } from "@/config/content";

/**
 * Orbital "digital network": concentric rings rotating slowly in opposite directions,
 * cyan nodes that breathe, connection lines that draw in, and floating data labels.
 * Decorative only (aria-hidden). All motion is transform/opacity/stroke-dashoffset.
 */
const C = 160; // centre of the 320×320 viewBox

const polar = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
};

const outer = [20, 95, 160, 230, 300].map((d) => polar(140, d));
const middle = [55, 140, 210, 330].map((d) => polar(100, d));
const inner = [0, 120, 240].map((d) => polar(58, d));

export function NetworkOrbit({ className = "" }: { className?: string }) {
  const labels = content.network.labels;
  return (
    <div aria-hidden className={`relative aspect-square w-full max-w-[22rem] ${className}`}>
      {/* soft focal light */}
      <div className="absolute inset-[18%] rounded-full bg-[radial-gradient(circle,#0099ff40,transparent_70%)] blur-2xl" />

      <svg viewBox="0 0 320 320" className="relative h-full w-full">
        <defs>
          <radialGradient id="core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#00d9ff" stopOpacity="0.9" />
            <stop offset="60%" stopColor="#168bff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#168bff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* static guide rings */}
        <g fill="none" stroke="#172b46">
          <circle cx={C} cy={C} r="140" />
          <circle cx={C} cy={C} r="100" />
          <circle cx={C} cy={C} r="58" />
        </g>

        {/* outer ring: dashed, slow clockwise, with nodes */}
        <g className="orbit-slow">
          <circle cx={C} cy={C} r="140" fill="none" stroke="#168bff" strokeOpacity="0.45" strokeDasharray="2 10" />
          {outer.map(([x, y], i) => (
            <circle key={i} className="node" style={{ "--d": `${i * 0.7}s` } as React.CSSProperties} cx={x} cy={y} r="3.2" fill="#00d9ff" />
          ))}
        </g>

        {/* middle ring: counter-clockwise */}
        <g className="orbit-rev">
          <circle cx={C} cy={C} r="100" fill="none" stroke="#69c7ff" strokeOpacity="0.25" strokeDasharray="40 14" />
          {middle.map(([x, y], i) => (
            <circle key={i} className="node" style={{ "--d": `${1 + i * 0.9}s` } as React.CSSProperties} cx={x} cy={y} r="2.6" fill="#69c7ff" />
          ))}
        </g>

        {/* connections drawn from the core to selected nodes */}
        <g stroke="#00d9ff" strokeOpacity="0.45" strokeWidth="1" fill="none">
          {inner.map(([x, y], i) => (
            <line key={i} className="link" style={{ "--d": `${0.4 + i * 0.35}s` } as React.CSSProperties} x1={C} y1={C} x2={x} y2={y} />
          ))}
          <path className="link" style={{ "--d": "1.4s" } as React.CSSProperties} d={`M${inner[0][0]} ${inner[0][1]} L${middle[0][0]} ${middle[0][1]}`} />
          <path className="link" style={{ "--d": "1.7s" } as React.CSSProperties} d={`M${inner[2][0]} ${inner[2][1]} L${middle[3][0]} ${middle[3][1]}`} />
        </g>

        {/* inner nodes + core */}
        {inner.map(([x, y], i) => (
          <circle key={i} className="node" style={{ "--d": `${0.5 + i}s` } as React.CSSProperties} cx={x} cy={y} r="3.6" fill="#00d9ff" />
        ))}
        <circle cx={C} cy={C} r="34" fill="url(#core)" />
        <circle cx={C} cy={C} r="9" fill="#eaf4ff" />
        <circle cx={C} cy={C} r="16" fill="none" stroke="#00d9ff" strokeOpacity="0.6" />
      </svg>

      {/* floating data indicators */}
      {labels.map((l, i) => (
        <div
          key={l.label}
          className="float absolute flex items-center gap-2 rounded-lg border border-line-strong bg-surface/90 px-2.5 py-1.5 text-[0.7rem] whitespace-nowrap shadow-[0_8px_24px_-12px_#000] backdrop-blur"
          style={{ ...l.pos, "--t": `${4.5 + i * 0.8}s`, "--d": `${i * 0.6}s` } as unknown as React.CSSProperties}
        >
          <span className="size-1.5 rounded-full bg-cyan shadow-[0_0_6px_#00d9ff]" />
          <span className="text-slate">{l.label}</span>
          <span className="font-bold text-ink">{l.value}</span>
        </div>
      ))}
    </div>
  );
}

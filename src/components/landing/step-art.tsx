import type { CSSProperties } from "react";

// The three "How it works" illustrations: small inline SVGs in the theme's tokens. Strokes
// draw and markers pop in once when the section is revealed (RevealObserver); static
// otherwise. Decorative: the step's own text says the same.

const at = (i: number, len?: number) =>
  ({ "--i": i, ...(len ? { "--len": len } : {}) }) as CSSProperties;

const line = {
  fill: "none",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 168 96" className="h-auto w-full max-w-[200px]" aria-hidden>
      {children}
    </svg>
  );
}

export function ConnectArt() {
  return (
    <Frame>
      <rect x={6} y={22} width={58} height={48} rx={9} className="fill-surface-2 stroke-line" />
      <path d="M17 41 l7 5 l-7 5" className="stroke-fg-muted" {...line} />
      <path d="M29 53 h11" className="stroke-fg-muted" {...line} />
      <rect x={104} y={22} width={58} height={48} rx={9} className="fill-surface-2 stroke-line" />
      <circle cx={122} cy={36} r={3.5} className="stroke-fg-muted" {...line} />
      <circle cx={122} cy={58} r={3.5} className="stroke-fg-muted" {...line} />
      <circle cx={144} cy={42} r={3.5} className="stroke-fg-muted" {...line} />
      <path
        d="M122 39.5 V54.5 M144 45.5 c0 6 -9 8 -18.5 11"
        className="stroke-fg-muted"
        {...line}
      />
      <path
        d="M68 46 H100"
        className="draw stroke-brand"
        style={at(1, 34)}
        {...line}
        strokeDasharray="4 5"
      />
      <g className="pop" style={at(3)}>
        <circle cx={84} cy={46} r={9} className="fill-brand" />
        <path d="M80 46 l3 3 l5.5 -6" className="stroke-on-brand" {...line} strokeWidth={1.8} />
      </g>
    </Frame>
  );
}

export function NightlyArt() {
  const rows = [26, 48, 70];
  return (
    <Frame>
      <path
        d="M30 14 a14 14 0 1 0 14 20 a11 11 0 1 1 -14 -20 z"
        className="fill-brand-soft stroke-brand"
        {...line}
      />
      {rows.map((y, i) => (
        <g key={y}>
          <rect
            x={62}
            y={y - 8}
            width={98}
            height={16}
            rx={6}
            className="fill-surface-2 stroke-line"
          />
          <rect x={70} y={y - 2} width={44 - i * 8} height={4} rx={2} className="fill-fg-subtle" />
          <g className="pop" style={at(2 + i * 2)}>
            <circle cx={148} cy={y} r={5.5} className={i === 1 ? "fill-sec" : "fill-ok"} />
          </g>
        </g>
      ))}
      <path d="M12 82 H52" className="draw stroke-line" style={at(1, 40)} {...line} />
    </Frame>
  );
}

export function DeliverArt() {
  return (
    <Frame>
      <rect x={30} y={22} width={92} height={60} rx={10} className="fill-surface-2 stroke-line" />
      <path
        d="M34 28 L76 56 L118 28"
        className="draw stroke-fg-muted"
        style={at(1, 100)}
        {...line}
      />
      <g className="pop" style={at(3)}>
        <rect x={104} y={10} width={44} height={22} rx={11} className="fill-brand" />
        <text
          x={126}
          y={25}
          textAnchor="middle"
          className="fill-on-brand font-sans text-[11.5px] font-semibold"
        >
          Mon
        </text>
      </g>
      <g className="pop" style={at(5)}>
        <circle cx={128} cy={74} r={9} className="fill-sec" />
        <path
          d="M128 69.5 V75 M128 78.2 V78.4"
          className="stroke-surface"
          {...line}
          strokeWidth={2}
        />
      </g>
    </Frame>
  );
}

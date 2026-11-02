import type { CSSProperties, ReactNode } from "react";

// "What Briff can and cannot see" as one picture: the repo, what the scanner reads, what Briff
// keeps and what a model call carries. Two layouts of the same panels (a row from 768px, a
// column below), drawn as inline SVG in the theme's tokens and animated by RevealObserver.
// The sample names follow the landing fixtures; `repo-2` is what pseudonym.ts gives
// garden.example among the sample org's three repos (code-point order).

const PANEL_H = 214;
const ROW = 19;
const MONO_CHAR = 7.25;

const order = (i: number) => ({ "--i": i }) as CSSProperties;
const drawLen = (len: number, i: number) => ({ "--len": len, "--i": i }) as CSSProperties;

function Panel({
  x,
  y,
  w,
  index,
  step,
  title,
  sub,
  children,
}: {
  x: number;
  y: number;
  w: number;
  index: number;
  step: number;
  title: string;
  sub: string;
  children: ReactNode;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="reveal-item" style={order(index)}>
        <rect
          width={w}
          height={PANEL_H}
          rx={16}
          className="fill-surface stroke-line"
          strokeWidth={1}
        />
        <circle cx={28} cy={30} r={12} className="fill-brand-soft" />
        <text
          x={28}
          y={34.5}
          textAnchor="middle"
          className="fill-brand font-sans text-[12.5px] font-semibold"
        >
          {step}
        </text>
        <text x={50} y={35} className="fill-fg font-display text-[17px] font-semibold">
          {title}
        </text>
        <text x={20} y={64} className="fill-fg-muted font-sans text-[12.5px]">
          {sub}
        </text>
        {children}
      </g>
    </g>
  );
}

function Check({ x, y, index }: { x: number; y: number; index: number }) {
  return (
    <path
      d={`M${x - 5} ${y - 4} l3.5 3.5 l6.5 -7`}
      className="pop stroke-brand"
      style={order(index)}
      fill="none"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

const REPO_FILES: { name: string; read: boolean }[] = [
  { name: "src/", read: false },
  { name: ".env", read: false },
  { name: ".git/", read: false },
  { name: "package.json", read: true },
  { name: "pnpm-lock.yaml", read: true },
  { name: "Dockerfile", read: true },
  { name: ".nvmrc", read: true },
];

const ROWS = ["next 16.3.5", "vite 7.1.9", "nodemailer 7.0.9", "node 24.11.0"];

function RepoPanel({ w }: { w: number }) {
  return REPO_FILES.map((f, i) => {
    const y = 92 + i * ROW;
    return (
      <g key={f.name}>
        <text
          x={20}
          y={y}
          className={
            f.read
              ? "fill-fg font-mono text-[12px] font-medium"
              : "fill-fg-subtle font-mono text-[12px]"
          }
        >
          {f.name}
        </text>
        {f.read ? (
          <Check x={w - 24} y={y - 4} index={4 + i} />
        ) : (
          <>
            <line
              x1={18}
              x2={22 + f.name.length * MONO_CHAR}
              y1={y - 4}
              y2={y - 4}
              className="draw stroke-fg-subtle"
              style={drawLen(f.name.length * MONO_CHAR + 4, 3 + i)}
              strokeWidth={1.2}
            />
            <text
              x={w - 20}
              y={y}
              textAnchor="end"
              className="fill-fg-subtle font-sans text-[11.5px]"
            >
              never read
            </text>
          </>
        )}
      </g>
    );
  });
}

function ScanPanel() {
  return ROWS.map((r, i) => (
    <g key={r} className="pop" style={order(5 + i)}>
      <rect
        x={20}
        y={80 + i * 30}
        width={r.length * MONO_CHAR + 20}
        height={22}
        rx={7}
        className="fill-surface-2 stroke-line"
      />
      <text x={30} y={95 + i * 30} className="fill-fg font-mono text-[12px]">
        {r}
      </text>
    </g>
  ));
}

function StorePanel() {
  return (
    <>
      <text x={20} y={96} className="fill-fg font-mono text-[12.5px] font-medium">
        garden.example
      </text>
      <path
        d={`M27 104 V${104 + ROWS.length * ROW - 6}`}
        className="stroke-line"
        strokeWidth={1.2}
        fill="none"
      />
      {ROWS.map((r, i) => (
        <g key={r}>
          <path
            d={`M27 ${117 + i * ROW} h10`}
            className="stroke-line"
            strokeWidth={1.2}
            fill="none"
          />
          <text x={44} y={121 + i * ROW} className="fill-fg-muted font-mono text-[12px]">
            {r}
          </text>
        </g>
      ))}
    </>
  );
}

function ModelPanel({ w }: { w: number }) {
  const nameEnd = 20 + "garden.example".length * MONO_CHAR;
  return (
    <>
      <text x={20} y={96} className="fill-fg-subtle font-mono text-[12.5px]">
        garden.example
      </text>
      <line
        x1={18}
        x2={nameEnd + 2}
        y1={92}
        y2={92}
        className="draw stroke-fg-muted"
        style={drawLen(nameEnd - 16, 8)}
        strokeWidth={1.4}
      />
      <g className="pop" style={order(9)}>
        <rect x={20} y={110} width={74} height={24} rx={7} className="fill-brand-soft" />
        <text x={57} y={126} textAnchor="middle" className="fill-brand font-mono text-[12.5px]">
          repo-2
        </text>
      </g>
      <text x={104} y={126} className="fill-fg-muted font-mono text-[12px]">
        next 16.3.5
      </text>
      <text x={20} y={164} className="fill-fg-muted font-sans text-[12.5px]">
        The answer is mapped back
      </text>
      <text x={20} y={182} className="fill-fg-muted font-sans text-[12.5px]">
        on Briff&apos;s server{w > 300 ? ", never by the model." : "."}
      </text>
    </>
  );
}

function Arrow({ d, len, index }: { d: string; len: number; index: number }) {
  return (
    <path
      d={d}
      className="draw stroke-brand"
      style={drawLen(len, index)}
      fill="none"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

const PANELS = [
  { title: "Your repo", sub: "Only the checked files are read" },
  { title: "Scanner", sub: "briff-scan or the GitHub App" },
  { title: "Briff", sub: "Keeps names and versions" },
  { title: "Model", sub: "Before any model call" },
] as const;

function Layout({ vertical }: { vertical: boolean }) {
  const w = vertical ? 340 : 260;
  const gap = vertical ? 44 : (1152 - 4 * 260) / 3;
  const pos = (i: number) =>
    vertical ? { x: 0, y: i * (PANEL_H + gap) } : { x: i * (w + gap), y: 0 };
  const width = vertical ? w : 1152;
  const height = vertical ? 4 * PANEL_H + 3 * gap : PANEL_H;
  const bodies = [
    <RepoPanel key="repo" w={w} />,
    <ScanPanel key="scan" />,
    <StorePanel key="store" />,
    <ModelPanel key="model" w={w} />,
  ];
  return (
    <svg
      viewBox={`-2 -2 ${width + 4} ${height + 4}`}
      className={vertical ? "block h-auto w-full md:hidden" : "hidden h-auto w-full md:block"}
      role="img"
      aria-labelledby={vertical ? "flow-title-v flow-desc-v" : "flow-title flow-desc"}
    >
      <title id={vertical ? "flow-title-v" : "flow-title"}>What leaves your repo</title>
      <desc id={vertical ? "flow-desc-v" : "flow-desc"}>
        The scanner reads package.json, lockfiles, the Dockerfile and version files, never source
        code, .env files or git history. It sends package names and versions to Briff. Before any
        model call, repo names are replaced by aliases such as repo-2.
      </desc>
      {PANELS.map((p, i) => {
        const { x, y } = pos(i);
        return (
          <Panel
            key={p.title}
            x={x}
            y={y}
            w={w}
            index={i * 2}
            step={i + 1}
            title={p.title}
            sub={p.sub}
          >
            {bodies[i]}
          </Panel>
        );
      })}
      {[0, 1, 2].map((i) => {
        const a = pos(i);
        if (vertical) {
          const x = w / 2;
          const y1 = a.y + PANEL_H + 8;
          const y2 = a.y + PANEL_H + gap - 8;
          return (
            <Arrow
              key={i}
              d={`M${x} ${y1} V${y2} M${x - 5} ${y2 - 6} L${x} ${y2} L${x + 5} ${y2 - 6}`}
              len={y2 - y1 + 16}
              index={i * 2 + 1}
            />
          );
        }
        const y = PANEL_H / 2;
        const x1 = a.x + w + 7;
        const x2 = a.x + w + gap - 7;
        return (
          <Arrow
            key={i}
            d={`M${x1} ${y} H${x2} M${x2 - 6} ${y - 5} L${x2} ${y} L${x2 - 6} ${y + 5}`}
            len={x2 - x1 + 16}
            index={i * 2 + 1}
          />
        );
      })}
    </svg>
  );
}

export function FlowDiagram() {
  return (
    <>
      <Layout vertical={false} />
      <Layout vertical />
    </>
  );
}

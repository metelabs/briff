import { ECOSYSTEMS, ecosystemLabel } from "@scan/ecosystems";

import {
  ArrowRight,
  ArrowUpRight,
  Download,
  FileX,
  GitBranch,
  Mail,
  Server,
  ShieldCheck,
  SquareTerminal,
  VenetianMask,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Tag } from "@/components/ui/tag";
import { limitLabel, PRICED_PLANS, PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";

import { FlowDiagram } from "./flow-diagram";
import {
  CHANGELOG_URL,
  LICENSE_URL,
  PRIVACY_URL,
  SELF_HOST_URL,
  SIGNUP_PATH,
  SOURCE_URL,
} from "./links";
import type { ScannedFileList } from "./scanned-files";
import bulletinDark from "./shots/bulletin-dark.webp";
import bulletinLight from "./shots/bulletin-light.webp";
import { ConnectArt, DeliverArt, NightlyArt } from "./step-art";

// The landing page's sections. Everything they show comes from props the page builds from
// the replays, the scanner's lists and PLANS; nothing here reads a session or the database.
// Sections marked data-reveal rise in when scrolled to (RevealObserver, globals.css).

const order = (i: number): CSSProperties => ({ "--i": i }) as CSSProperties;

const LINK =
  "text-brand inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline";

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={LINK}>
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden />
    </a>
  );
}

function Internal({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={LINK}>
      {children}
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

function SectionHead({
  id,
  eyebrow,
  title,
  lead,
  center = false,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
  center?: boolean;
}) {
  return (
    <div className={cn("reveal-item mb-8 max-w-[44rem]", center && "mx-auto text-center")}>
      <p className="text-brand text-[13px] font-semibold">{eyebrow}</p>
      <h2
        id={id}
        className="font-display mt-2 scroll-mt-24 text-[clamp(28px,3.6vw,42px)] leading-[1.05] font-semibold tracking-[-0.03em] text-balance"
      >
        {title}
      </h2>
      {lead && <p className="text-fg-muted mt-3 text-[17px] leading-[1.5]">{lead}</p>}
    </div>
  );
}

function CtaButtons({ incidentHref }: { incidentHref: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Link href={SIGNUP_PATH} className={buttonVariants({ variant: "primary", size: "lg" })}>
        Create an account
        <ArrowRight className="size-4" aria-hidden />
      </Link>
      <Link href={incidentHref} className={buttonVariants({ variant: "secondary", size: "lg" })}>
        See a real incident
      </Link>
    </div>
  );
}

export interface HeroIncident {
  href: string;
  delay: string;
  subject: string;
}

/** `pricing`: the hosted service (BRIFF_CLOUD) names its Free plan; a self-hosted instance does not. */
export function Hero({ pricing, incident }: { pricing: boolean; incident: HeroIncident }) {
  return (
    <section className="grid items-center gap-x-12 gap-y-12 pt-10 pb-20 min-[980px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] min-[980px]:pb-28 md:pt-16">
      <div className="min-w-0">
        <p className="text-fg-muted text-[13.5px]">Weekly on Monday · security the same day</p>
        <h1
          className="font-display mt-4 text-[clamp(36px,5.2vw,62px)] leading-[1.02] font-semibold tracking-[-0.04em] text-balance"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          Your stack&apos;s weekly briefing, plus{" "}
          <span className="text-sec whitespace-nowrap">same-day</span> security alerts.
        </h1>
        <p className="text-fg mt-6 max-w-[34rem] text-[18px] leading-[1.5] text-pretty">
          Briff reads lockfiles and manifests, never your source code.{" "}
          <span className="text-fg-muted">Self-host it or let us run it.</span>
        </p>
        <div className="mt-8">
          <CtaButtons incidentHref={incident.href} />
        </div>
        <p className="text-fg-muted mt-4 text-[13px]">
          {pricing
            ? `Free for ${limitLabel(PLANS.free.repos, "repo")} · Open source, AGPL`
            : "Open source, AGPL · One Docker image and Postgres"}
        </p>
      </div>
      <HeroVisual incident={incident} />
    </section>
  );
}

/**
 * The sample bulletin as a screenshot in a browser frame (light and dark files, the theme
 * picks one; both are the landing page's own sample, see docs/LANDING.md for how to
 * re-shoot them), with the PHP2Shell replay's fix email on top.
 */
function HeroVisual({ incident }: { incident: HeroIncident }) {
  const image = {
    alt: "A Monday bulletin in Briff: two items need attention, with a command for each repo",
    // Explicit so the hero also renders where the .webp import is a plain URL (Vitest).
    width: 1600,
    height: 1034,
    sizes: "(min-width: 1200px) 640px, (min-width: 980px) 55vw, 100vw",
    fetchPriority: "high" as const,
    className: "block h-auto w-full",
  };
  return (
    <div className="landing-frame relative min-w-0">
      <div className="landing-float">
        <div className="bg-surface border-line shadow-raised overflow-hidden rounded-[18px] border">
          <div className="border-line flex items-center gap-1.5 border-b px-3.5 py-2.5">
            <span className="bg-line size-2.5 rounded-full" />
            <span className="bg-line size-2.5 rounded-full" />
            <span className="bg-line size-2.5 rounded-full" />
            <span className="bg-surface-2 text-fg-muted mx-auto rounded-full px-4 py-0.5 font-mono text-[11.5px]">
              Weekly · W44
            </span>
          </div>
          <div className="relative">
            <Image
              {...image}
              alt={image.alt}
              src={bulletinLight}
              className={cn(image.className, "dark:hidden")}
            />
            <Image
              {...image}
              alt={image.alt}
              src={bulletinDark}
              className={cn(image.className, "hidden dark:block")}
            />
          </div>
        </div>
      </div>
      <Link
        href={incident.href}
        className="bg-surface border-line shadow-raised hover:border-line-strong ease-entrance relative z-[1] mx-3 -mt-14 flex max-w-[340px] gap-3 rounded-[14px] border p-3.5 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 min-[980px]:absolute min-[980px]:-bottom-8 min-[980px]:-left-8 min-[980px]:mx-0 min-[980px]:mt-0 min-[980px]:w-[340px]"
      >
        <span className="bg-sec-soft text-sec grid size-9 shrink-0 place-items-center rounded-[10px]">
          <Mail className="size-[18px]" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Tag kind="security">Security</Tag>
            <b className="text-sec text-[13px] font-semibold whitespace-nowrap tabular-nums">
              {incident.delay}
            </b>
            <span className="text-fg-muted text-[12.5px]">after the advisory</span>
          </span>
          <span className="mt-1 line-clamp-2 block text-[13px] leading-[1.35] font-medium">
            {incident.subject}
          </span>
        </span>
      </Link>
    </div>
  );
}

const TRUST_CARDS = [
  {
    icon: FileX,
    title: "No source code, ever",
    body: "Briff reads package manifests, lockfiles, Dockerfiles and version files. Application code, .env files and git history are never opened.",
  },
  {
    icon: VenetianMask,
    title: "Repo names never reach the model",
    body: "Before any model call, each repo name becomes repo-1, repo-2. The answer is mapped back on Briff's server.",
  },
  {
    icon: Server,
    title: "Run it on your own server",
    body: "One Docker image and Postgres, open source under AGPL-3.0. Leave the model key empty and nothing goes to a model.",
  },
  {
    icon: Download,
    title: "Export or delete everything",
    body: "Settings exports your organisation as one JSON file. Deleting it removes every row it owns, at once.",
  },
] as const;

export function TrustSection({ files }: { files: ScannedFileList }) {
  const count = files.names.length + files.patterns.length;
  return (
    <section data-reveal className="pb-24 md:pb-32">
      <SectionHead
        id="trust"
        eyebrow="Trust first"
        title="What Briff can and cannot see"
        lead="The scanner reads dependency files. Everything else stays where it is."
      />
      <FlowDiagram />
      <p
        className="reveal-item font-display mt-6 flex items-center justify-center gap-2.5 text-center text-[clamp(19px,2vw,23px)] font-semibold tracking-[-0.02em]"
        style={order(8)}
      >
        <ShieldCheck className="text-ok size-6 shrink-0" strokeWidth={1.8} aria-hidden />
        Nothing else leaves your repo.
      </p>

      <ul className="mt-10 grid gap-3 min-[560px]:grid-cols-2 min-[1100px]:grid-cols-4">
        {TRUST_CARDS.map((c, i) => (
          <li
            key={c.title}
            className="reveal-item bg-surface border-line hover:border-line-strong hover:shadow-lift ease-entrance rounded-card flex flex-col border p-[18px] transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5"
            style={order(8 + i)}
          >
            <span className="bg-brand-soft text-brand grid size-10 place-items-center rounded-[12px]">
              <c.icon className="size-5" strokeWidth={1.8} aria-hidden />
            </span>
            <h3 className="type-h2 mt-4">{c.title}</h3>
            <p className="text-fg-muted mt-2 text-[14px] leading-[1.5]">{c.body}</p>
            {i === 0 && (
              <details className="group/files mt-auto pt-3">
                <summary className="text-brand cursor-pointer text-[13px] font-medium">
                  <span className="group-open/files:hidden">Show</span>
                  <span className="hidden group-open/files:inline">Hide</span> all {count} file
                  names
                </summary>
                <ul className="mt-2 flex flex-wrap gap-1" aria-label="Files Briff reads">
                  {[...files.names, ...files.patterns].map((f) => (
                    <li key={f} className="max-w-full min-w-0">
                      <Chip className="text-[11.5px] break-all whitespace-normal">{f}</Chip>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {i === 2 && (
              <p className="mt-auto pt-3 text-[13px]">
                <Internal href={SELF_HOST_URL}>Self-hosting guide</Internal>
              </p>
            )}
          </li>
        ))}
      </ul>

      <div
        className="reveal-item bg-surface-2 border-line rounded-card mt-3 grid gap-5 border p-[18px] min-[980px]:grid-cols-[13rem_minmax(0,1fr)_minmax(0,1fr)] min-[980px]:items-start"
        style={order(12)}
      >
        <h3 className="type-h2">Connect without giving access</h3>
        <div className="flex gap-3">
          <SquareTerminal
            className="text-brand mt-0.5 size-5 shrink-0"
            strokeWidth={1.8}
            aria-hidden
          />
          <p className="text-[14px] leading-[1.5]">
            <code className="font-mono text-[13px] font-medium">briff-scan</code> runs on your
            machine or in CI and uploads only the dependency list.{" "}
            <span className="text-fg-muted">
              <code className="font-mono text-[12.5px] whitespace-nowrap">--dry-run</code> shows it
              first.
            </span>
          </p>
        </div>
        <div className="flex gap-3">
          <GitBranch className="text-brand mt-0.5 size-5 shrink-0" strokeWidth={1.8} aria-hidden />
          <p className="text-[14px] leading-[1.5]">
            The GitHub App needs read access to contents only{" "}
            <span className="text-fg-muted">
              (plus the metadata GitHub requires) and fetches only the files above.
            </span>
          </p>
        </div>
      </div>

      <p className="reveal-item mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[14px]" style={order(13)}>
        <Internal href="/privacy">Privacy policy</Internal>
        <Internal href={PRIVACY_URL}>Every outbound connection</Internal>
        <External href={SOURCE_URL}>Read the code on GitHub</External>
      </p>
    </section>
  );
}

const STEPS = [
  {
    art: ConnectArt,
    title: "Connect",
    body: "Install the GitHub App, or run briff-scan in CI or on your laptop.",
  },
  {
    art: NightlyArt,
    title: "Checked every night",
    body: "Your versions are checked against new advisories, releases and end-of-life dates.",
  },
  {
    art: DeliverArt,
    title: "Told what to do",
    body: "A bulletin every Monday, and a same-day email for critical and high fixes.",
  },
] as const;

export function HowSection() {
  return (
    <section data-reveal className="pb-24 md:pb-32">
      <SectionHead id="how" eyebrow="How it works" title="Three steps, then it runs itself" />
      <ol className="grid gap-3 min-[768px]:grid-cols-3">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className="reveal-item bg-surface border-line rounded-card border p-[18px]"
            style={order(i * 2)}
          >
            <div className="bg-surface-2 rounded-inset grid h-[132px] place-items-center">
              <s.art />
            </div>
            <p className="text-fg-muted mt-4 font-mono text-[12px]">0{i + 1}</p>
            <h3 className="type-h3 mt-1">{s.title}</h3>
            <p className="text-fg-muted mt-1.5 text-[14.5px] leading-[1.5]">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export interface ReplayLink {
  id: string;
  title: string;
}

export function ShowcaseSection({
  children,
  replays,
}: {
  children: ReactNode;
  replays: ReplayLink[];
}) {
  return (
    <section data-reveal className="pb-24 md:pb-32">
      <SectionHead
        id="sample"
        eyebrow="Show, don't tell"
        title="What lands in your inbox, and what you see in the app"
      />
      <div className="reveal-item" style={order(1)}>
        {children}
      </div>
      <p
        className="reveal-item mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px]"
        style={order(2)}
      >
        <span className="text-fg-muted">Replay a real incident:</span>
        {replays.map((r) => (
          <Link key={r.id} href={`/replay/${r.id}`} className={LINK}>
            {r.title}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        ))}
      </p>
    </section>
  );
}

/** Ecosystems from the scanner's own list, plus Actions and base images, as quiet text marks. */
export function CoverageStrip() {
  const marks = [
    ...ECOSYSTEMS.filter((e) => e !== "GitHub Actions").map(ecosystemLabel),
    "GitHub Actions",
    "Docker",
  ];
  return (
    <section data-reveal aria-labelledby="coverage" className="pb-24 md:pb-32">
      <div className="reveal-item border-line border-y py-8">
        <h2 id="coverage" className="text-fg-muted text-center text-[13.5px]">
          Packages, runtimes, Actions and base images across
        </h2>
        <ul className="mt-5 flex flex-wrap justify-center gap-x-7 gap-y-3">
          {marks.map((m) => (
            <li
              key={m}
              className="text-fg-muted hover:text-fg font-mono text-[15px] font-medium tracking-[-0.01em] transition-colors duration-150"
            >
              {m}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function OpenSection() {
  const items = [
    { label: "Open source, AGPL-3.0", href: LICENSE_URL },
    { label: "Self-hostable", href: SELF_HOST_URL },
    { label: "Changelog", href: CHANGELOG_URL },
  ];
  return (
    <section data-reveal className="pb-24 md:pb-32">
      <div className="grid items-center gap-10 min-[980px]:grid-cols-2">
        <div>
          <SectionHead
            id="open"
            eyebrow="Built in the open"
            title="Read the code. Run your own."
            lead="The app, the scanner and the code behind every claim on this page live in one public repository."
          />
          <ul className="reveal-item flex flex-wrap gap-2" style={order(1)}>
            {items.map((it) => (
              <li key={it.label}>
                <Link
                  href={it.href}
                  className={cn(buttonVariants({ variant: "secondary", size: "md" }))}
                >
                  {it.label}
                  <ArrowRight className="text-fg-muted size-4" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div
          className="reveal-item bg-surface border-line rounded-card overflow-hidden border"
          style={order(2)}
        >
          <div className="border-line text-fg-muted flex items-center gap-2 border-b px-4 py-2.5 font-mono text-[12px]">
            <SquareTerminal className="size-4" aria-hidden />
            /opt/briff
          </div>
          <pre className="no-scrollbar overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-[1.9]">
            <span className="text-fg-subtle">$ </span>curl -fsSLO …/briff/main/compose.yaml{"\n"}
            <span className="text-fg-subtle">$ </span>docker compose up -d{"\n"}
            <span className="text-ok">✓</span> web, worker, postgres{" "}
            <span className="text-fg-muted">healthy</span>
          </pre>
        </div>
      </div>
    </section>
  );
}

export function PricingTeaser() {
  return (
    <section data-reveal className="pb-24 md:pb-32">
      <SectionHead id="pricing" eyebrow="Pricing" title="Start free, pay when it pays off" />
      <ul className="grid gap-3 min-[768px]:grid-cols-3">
        {PRICED_PLANS.map((p, i) => (
          <li
            key={p.id}
            className="reveal-item bg-surface border-line rounded-card border p-[18px]"
            style={order(i + 1)}
          >
            <h3 className="type-h2">{p.name}</h3>
            <p className="mt-3">
              <b className="type-stat">${p.monthlyUsd ?? 0}</b>
              <span className="text-fg-muted text-[13px]"> / month</span>
            </p>
            <p className="text-fg-muted mt-2 text-[13.5px]">{limitLabel(p.repos, "repo")}</p>
          </li>
        ))}
      </ul>
      <p className="reveal-item mt-5 text-[14px]" style={order(4)}>
        <Link href="/pricing" className={LINK}>
          Compare plans
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </p>
    </section>
  );
}

export function FinalCta({ incidentHref }: { incidentHref: string }) {
  return (
    <section data-reveal className="pb-24">
      <div className="reveal-item bg-surface border-line rounded-card border px-6 py-12 text-center md:py-16">
        <h2 className="font-display mx-auto max-w-[20ch] text-[clamp(28px,3.6vw,42px)] leading-[1.05] font-semibold tracking-[-0.03em] text-balance">
          Your first bulletin arrives next Monday.
        </h2>
        <p className="text-fg-muted mx-auto mt-3 max-w-[40ch] text-[16px]">
          Connect a repo in a few minutes; the nightly security check picks it up.
        </p>
        <div className="mt-8 flex justify-center">
          <CtaButtons incidentHref={incidentHref} />
        </div>
      </div>
    </section>
  );
}

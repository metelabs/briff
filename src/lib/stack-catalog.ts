import { RUNTIME_NAMES } from "@/lib/runtime-security";
import { ECOSYSTEMS, ecosystemLabel, normalizePackageName, type Ecosystem } from "@scan/ecosystems";
import { RUNTIME_IDS, type RuntimeId } from "@scan/runtimes";

// What a manual stack (Repo.source = manual) can hold, as pure data: runtimes, packages of a
// supported ecosystem, and tools followed through their GitHub releases. Shared by the picker,
// the save action and the docs. Icons are simple-icons slugs (src/lib/stack-icons.ts), or
// null for a monogram tile.

/** Package.ecosystem of a tool followed through GitHub: name `owner/repo`, never sent to OSV. */
export const GITHUB_ECOSYSTEM = "GitHub";

/** Ecosystems a package entry can use: every scanner ecosystem except Actions, plus GitHub. */
export const PICKABLE_ECOSYSTEMS = [
  ...ECOSYSTEMS.filter((e) => e !== "GitHub Actions"),
  GITHUB_ECOSYSTEM,
] as const;
export type PickableEcosystem = (typeof PICKABLE_ECOSYSTEMS)[number];

export type StackItemKind = "runtime" | "package" | "tool";

export interface CatalogEntry {
  kind: StackItemKind;
  /** `runtime:node`, `npm:react`, `GitHub:dokploy/dokploy`. */
  key: string;
  /** Runtime id for runtimes; Package.ecosystem otherwise. */
  ecosystem: PickableEcosystem | "runtime";
  /** Runtime id, package name or `owner/repo`. */
  name: string;
  label: string;
  /** simple-icons slug, or null for a monogram tile. */
  icon: string | null;
}

/** A picked item as the save action receives it; `version` is optional everywhere. */
export type StackSelection =
  | { kind: "runtime"; name: RuntimeId; version?: string }
  | { kind: "package"; ecosystem: PickableEcosystem; name: string; version?: string }
  | { kind: "tool"; name: string };

export const RUNTIME_ICONS: Readonly<Record<RuntimeId, string | null>> = {
  node: "nodedotjs",
  php: "php",
  python: "python",
  go: "go",
  ruby: "ruby",
  java: "openjdk",
  dotnet: "dotnet",
  rust: "rust",
  postgres: "postgresql",
  mysql: "mysql",
  mariadb: "mariadb",
  redis: "redis",
  valkey: null,
  nginx: "nginx",
  deno: "deno",
  bun: "bun",
};

/** Picker order: application runtimes first, then databases and servers. */
const RUNTIME_ORDER: readonly RuntimeId[] = [
  "node",
  "bun",
  "deno",
  "php",
  "python",
  "go",
  "ruby",
  "java",
  "dotnet",
  "rust",
  "postgres",
  "mysql",
  "mariadb",
  "redis",
  "valkey",
  "nginx",
];

export const RUNTIME_ENTRIES: readonly CatalogEntry[] = RUNTIME_ORDER.map((id) => ({
  kind: "runtime",
  key: `runtime:${id}`,
  ecosystem: "runtime",
  name: id,
  label: RUNTIME_NAMES[id] ?? id,
  icon: RUNTIME_ICONS[id],
}));

const pkg = (
  ecosystem: PickableEcosystem,
  name: string,
  label: string,
  icon: string | null
): CatalogEntry => ({
  kind: "package",
  key: itemKey(ecosystem, name),
  ecosystem,
  name,
  label,
  icon,
});

/** Popular packages and frameworks, with the exact registry name Briff matches on. */
export const PACKAGE_ENTRIES: readonly CatalogEntry[] = [
  pkg("npm", "react", "React", "react"),
  pkg("npm", "next", "Next.js", "nextdotjs"),
  pkg("npm", "vue", "Vue", "vuedotjs"),
  pkg("npm", "nuxt", "Nuxt", "nuxt"),
  pkg("npm", "svelte", "Svelte", "svelte"),
  pkg("npm", "@sveltejs/kit", "SvelteKit", "svelte"),
  pkg("npm", "@angular/core", "Angular", "angular"),
  pkg("npm", "astro", "Astro", "astro"),
  pkg("npm", "@remix-run/react", "Remix", "remix"),
  pkg("npm", "express", "Express", "express"),
  pkg("npm", "fastify", "Fastify", "fastify"),
  pkg("npm", "@nestjs/core", "NestJS", "nestjs"),
  pkg("npm", "hono", "Hono", "hono"),
  pkg("npm", "prisma", "Prisma", "prisma"),
  pkg("npm", "drizzle-orm", "Drizzle", "drizzle"),
  pkg("npm", "typeorm", "TypeORM", "typeorm"),
  pkg("npm", "tailwindcss", "Tailwind CSS", "tailwindcss"),
  pkg("npm", "vite", "Vite", "vite"),
  pkg("npm", "webpack", "Webpack", "webpack"),
  pkg("npm", "esbuild", "esbuild", "esbuild"),
  pkg("npm", "vitest", "Vitest", "vitest"),
  pkg("npm", "jest", "Jest", "jest"),
  pkg("npm", "@playwright/test", "Playwright", null),
  pkg("npm", "eslint", "ESLint", "eslint"),
  pkg("npm", "typescript", "TypeScript", "typescript"),
  pkg("npm", "expo", "Expo", "expo"),
  pkg("npm", "react-native", "React Native", "react"),
  pkg("npm", "electron", "Electron", "electron"),
  pkg("npm", "storybook", "Storybook", "storybook"),
  pkg("npm", "redux", "Redux", "redux"),
  pkg("npm", "@tanstack/react-query", "TanStack Query", "reactquery"),
  pkg("npm", "zod", "Zod", "zod"),
  pkg("npm", "@sentry/node", "Sentry SDK", "sentry"),
  pkg("Packagist", "laravel/framework", "Laravel", "laravel"),
  pkg("Packagist", "symfony/http-kernel", "Symfony", "symfony"),
  pkg("PyPI", "django", "Django", "django"),
  pkg("PyPI", "flask", "Flask", "flask"),
  pkg("PyPI", "fastapi", "FastAPI", "fastapi"),
  pkg("RubyGems", "rails", "Rails", "rubyonrails"),
  pkg("Maven", "org.springframework.boot:spring-boot", "Spring Boot", "springboot"),
  // The shared framework reference every ASP.NET Core project builds against.
  pkg("NuGet", "microsoft.aspnetcore.app.ref", "ASP.NET Core", "dotnet"),
  pkg("Go", "github.com/gin-gonic/gin", "Gin", "gin"),
  pkg("crates.io", "axum", "Axum", null),
  pkg("Hex", "phoenix", "Phoenix", "phoenixframework"),
  // Flutter ships as an SDK, not a pub.dev package: its releases are on GitHub.
  pkg(GITHUB_ECOSYSTEM, "flutter/flutter", "Flutter", "flutter"),
];

const tool = (name: string, label: string, icon: string | null): CatalogEntry => ({
  kind: "tool",
  key: itemKey(GITHUB_ECOSYSTEM, name),
  ecosystem: GITHUB_ECOSYSTEM,
  name,
  label,
  icon,
});

/** Self-hosted tools and platforms followed through their GitHub releases and advisories. */
export const TOOL_ENTRIES: readonly CatalogEntry[] = [
  tool("Dokploy/dokploy", "Dokploy", null),
  tool("coollabsio/coolify", "Coolify", "coolify"),
  tool("traefik/traefik", "Traefik", "traefikproxy"),
  tool("caddyserver/caddy", "Caddy", "caddy"),
  tool("docker/compose", "Docker Compose", "docker"),
  tool("kubernetes/kubernetes", "Kubernetes", "kubernetes"),
  tool("hashicorp/terraform", "Terraform", "terraform"),
  tool("ansible/ansible", "Ansible", "ansible"),
  tool("grafana/grafana", "Grafana", "grafana"),
  tool("prometheus/prometheus", "Prometheus", "prometheus"),
  tool("n8n-io/n8n", "n8n", "n8n"),
  tool("supabase/supabase", "Supabase", "supabase"),
  tool("directus/directus", "Directus", "directus"),
  tool("payloadcms/payload", "Payload", null),
  tool("strapi/strapi", "Strapi", "strapi"),
  tool("TryGhost/Ghost", "Ghost", "ghost"),
  tool("minio/minio", "MinIO", "minio"),
  tool("keycloak/keycloak", "Keycloak", "keycloak"),
];

export const CATALOG: readonly CatalogEntry[] = [
  ...RUNTIME_ENTRIES,
  ...PACKAGE_ENTRIES,
  ...TOOL_ENTRIES,
];

/** Every simple-icons slug the catalog uses (src/lib/stack-icons.ts imports exactly these). */
export function catalogIconSlugs(): string[] {
  return [...new Set(CATALOG.flatMap((e) => (e.icon ? [e.icon] : [])))].sort();
}

/** The key of a package or tool: `npm:react`, `GitHub:dokploy/dokploy` (case-insensitive). */
export function itemKey(ecosystem: string, name: string): string {
  return `${ecosystem}:${ecosystem === GITHUB_ECOSYSTEM ? name.toLowerCase() : name}`;
}

const BY_KEY = new Map(CATALOG.map((e) => [e.key, e]));

export function catalogEntry(key: string): CatalogEntry | null {
  return BY_KEY.get(key) ?? null;
}

/** The key of a selection, matching `CatalogEntry.key`. */
export function selectionKey(s: StackSelection): string {
  if (s.kind === "runtime") return `runtime:${s.name}`;
  if (s.kind === "tool") return itemKey(GITHUB_ECOSYSTEM, s.name);
  return itemKey(s.ecosystem, s.name);
}

/** Case- and punctuation-insensitive search over labels and names. */
export function searchCatalog(query: string, entries: readonly CatalogEntry[] = CATALOG) {
  const q = fold(query);
  if (!q) return [...entries];
  return entries.filter((e) => fold(e.label).includes(q) || fold(e.name).includes(q));
}

function fold(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function isRuntimeId(value: string): value is RuntimeId {
  return (RUNTIME_IDS as readonly string[]).includes(value);
}

export function isPickableEcosystem(value: string): value is PickableEcosystem {
  return (PICKABLE_ECOSYSTEMS as readonly string[]).includes(value);
}

/** `npm`, `Composer`, `GitHub`: the label next to a package. */
export function pickableEcosystemLabel(ecosystem: PickableEcosystem): string {
  return ecosystem === GITHUB_ECOSYSTEM ? "GitHub" : ecosystemLabel(ecosystem);
}

const OWNER_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/;

/** `owner/repo` as GitHub allows it (no `..`, no `.git` suffix). */
export function isGithubRepoName(name: string): boolean {
  return OWNER_REPO.test(name) && !name.endsWith(".git") && !/(^|\/)\.\.?$/.test(name);
}

// Shapes each ecosystem's names take, checked before anything is stored or looked up.
const NAME_SHAPES: Readonly<Record<Exclude<PickableEcosystem, "GitHub">, RegExp>> = {
  npm: /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/,
  Packagist: /^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$/,
  PyPI: /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/,
  Go: /^[a-z0-9.-]+\.[a-z]{2,}(\/[A-Za-z0-9._~+-]+)+$/,
  RubyGems: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  "crates.io": /^[A-Za-z][A-Za-z0-9_-]{0,63}$/,
  Maven: /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/,
  NuGet: /^[a-z0-9_][a-z0-9_.-]*$/,
  Pub: /^[a-z_][a-z0-9_]*$/,
  SwiftURL: /^[a-z0-9.-]+\.[a-z]{2,}(\/[A-Za-z0-9._-]+)+$/,
  Hex: /^[a-z][a-z0-9_]*$/,
};

/**
 * The name Briff stores for a typed package (`normalizePackageName`), or null when it does not
 * have the ecosystem's shape. GitHub names keep their case (`TryGhost/Ghost`).
 */
export function normalizePickedName(ecosystem: PickableEcosystem, raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 214) return null;
  if (ecosystem === GITHUB_ECOSYSTEM) return isGithubRepoName(trimmed) ? trimmed : null;
  const name = normalizePackageName(ecosystem as Ecosystem, trimmed);
  return NAME_SHAPES[ecosystem].test(name) ? name : null;
}

export const VERSION_MAX = 64;

/** A version or range as typed: digits, letters and range operators only. */
export function cleanVersion(raw: string | undefined): string | null | undefined {
  const v = raw?.trim();
  if (!v || v === "*" || v.toLowerCase() === "any") return undefined;
  if (v.length > VERSION_MAX || !/^[A-Za-z0-9.^~<>=*|,+_ -]+$/.test(v)) return null;
  return v;
}

/** A runtime major (`22`) or `major.minor` (`8.3`); anything else is not a release line. */
export function cleanRuntimeVersion(raw: string | undefined): string | null | undefined {
  const v = raw?.trim().replace(/^v/i, "");
  if (!v) return undefined;
  return /^\d{1,4}(\.\d{1,4})?$/.test(v) ? v : null;
}

/** An exact version (`19.2.1`, `2.0.0-rc.1`): stored like a scanned install, sent to OSV. */
export function isExactVersion(version: string): boolean {
  return /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
}

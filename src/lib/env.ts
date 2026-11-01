import "server-only";

import { z } from "zod";

// Runtime configuration. Everything is read at request/job time, never at build
// time: the Docker image is built in CI without any of these values.

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

/** "true"/"false"; empty or unset falls back to the default. */
function booleanFlag(fallback: boolean) {
  return optionalString
    .pipe(z.enum(["true", "false"]).optional())
    .transform((v) => (v === undefined ? fallback : v === "true"));
}

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  ALLOW_SIGNUP: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  // Deprecated fallback for /api/scan; per-org ScanToken rows replace it (docs/SCANNER.md).
  SCANNER_TOKEN: optionalString.pipe(z.string().min(24).optional()),
  SCANNER_ORG_ID: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: optionalString
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .pipe(z.number().int().positive().optional()),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  FROM_EMAIL: optionalString.pipe(z.email().optional()),
  // Error reporting (worker and web server; src/lib/sentry.ts). Unset: Sentry is never loaded.
  SENTRY_DSN: optionalString.pipe(z.url().optional()),
  // Operator alerts (docs/OPERATIONS.md): job failures and stale scheduled jobs.
  ALERT_WEBHOOK_URL: optionalString.pipe(z.url({ protocol: /^https?$/ }).optional()),
  // Comma-separated; default: the instance admin's email.
  OPS_ALERT_EMAIL: optionalString
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean)
    )
    .pipe(z.array(z.email())),
  GITHUB_TOKEN: optionalString,
  // Briff GitHub App (docs/GITHUB-APP.md). All six or none; web and worker both need them.
  GITHUB_APP_ID: optionalString,
  GITHUB_APP_SLUG: optionalString,
  // PEM, either as is (newlines may be written as \n) or base64-encoded.
  GITHUB_APP_PRIVATE_KEY: optionalString,
  GITHUB_APP_WEBHOOK_SECRET: optionalString,
  // The app's OAuth client: proves the installing user can access the installation.
  GITHUB_APP_CLIENT_ID: optionalString,
  GITHUB_APP_CLIENT_SECRET: optionalString,
  BRIFF_MODEL_TRIAGE: optionalString.transform((v) => v ?? "claude-haiku-5-5"),
  BRIFF_MODEL_SYNTHESIS: optionalString.transform((v) => v ?? "claude-sonnet-5-5"),
  BRIFF_URGENT_EMAIL: booleanFlag(true),
  // Weekly synthesis and triage go through the Message Batches API (50% price, minutes of latency).
  BRIFF_LLM_BATCH: booleanFlag(true),
  // Development only: a deterministic stand-in for the Anthropic API (refused in production).
  BRIFF_LLM_FAKE: booleanFlag(false),
  // The hosted service (app.briff.dev): plans, limits, pricing and billing. Off for self-hosted
  // instances, where every org is unlimited and nothing plan-related renders (src/lib/plans.ts).
  BRIFF_CLOUD: booleanFlag(false),
  // Billing through Paddle (docs/BILLING.md), hosted service only. Without the API key or the
  // client token the billing page says billing is not configured; nothing else depends on them.
  PADDLE_ENV: optionalString
    .pipe(z.enum(["sandbox", "live"]).optional())
    .transform((v) => v ?? "sandbox"),
  PADDLE_API_KEY: optionalString,
  // Public by design (Paddle.js runs in the browser with it); passed to the page as a prop.
  PADDLE_CLIENT_TOKEN: optionalString,
  // The notification destination's secret: verifies POST /api/billing/paddle.
  PADDLE_WEBHOOK_SECRET: optionalString,
  // Development only: canned Paddle API answers so the billing page renders without a key.
  BRIFF_PADDLE_FAKE: booleanFlag(false),
});

const cloudEnvSchema = serverEnvSchema.pick({ BRIFF_CLOUD: true });
const billingEnvSchema = serverEnvSchema.pick({
  NODE_ENV: true,
  BRIFF_CLOUD: true,
  PADDLE_API_KEY: true,
  PADDLE_CLIENT_TOKEN: true,
  BRIFF_PADDLE_FAKE: true,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n  ${issues.join("\n  ")}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * BRIFF_CLOUD alone, with the same schema getEnv() uses. Limits are checked deep in scan
 * ingestion and stream writes, which must not fail on an unrelated variable (the DB-backed tests
 * call them without auth config); once getEnv() has parsed, its value is used.
 */
export function isCloud(): boolean {
  if (cached) return cached.BRIFF_CLOUD;
  return cloudEnvSchema.parse(process.env).BRIFF_CLOUD;
}

/**
 * Whether checkout can open on this instance (hosted, with the Paddle API key and client token,
 * or the development fake). Narrow like isCloud(): the public pricing page reads it.
 */
export function isBillingConfigured(): boolean {
  const env = cached ?? billingEnvSchema.parse(process.env);
  if (!env.BRIFF_CLOUD) return false;
  if (env.BRIFF_PADDLE_FAKE) return env.NODE_ENV !== "production";
  return !!env.PADDLE_API_KEY && !!env.PADDLE_CLIENT_TOKEN;
}

/** Test hook: forget the parsed env so the next getEnv() re-reads process.env. */
export function resetEnvCache(): void {
  cached = null;
}

// Optional integrations that later pipeline steps depend on. Missing ones are
// reported by /api/health instead of crashing the app.
const FEATURE_GROUPS: { feature: string; vars: (keyof ServerEnv)[] }[] = [
  { feature: "LLM triage and synthesis", vars: ["ANTHROPIC_API_KEY"] },
  {
    feature: "email delivery",
    vars: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "FROM_EMAIL"],
  },
  {
    feature: "GitHub App",
    vars: [
      "GITHUB_APP_ID",
      "GITHUB_APP_SLUG",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APP_WEBHOOK_SECRET",
      "GITHUB_APP_CLIENT_ID",
      "GITHUB_APP_CLIENT_SECRET",
    ],
  },
];

export function envWarnings(source: NodeJS.ProcessEnv = process.env): string[] {
  const warnings: string[] = [];
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      warnings.push(`invalid ${issue.path.join(".")}: ${issue.message}`);
    }
    return warnings;
  }
  const groups = parsed.data.BRIFF_CLOUD
    ? [
        ...FEATURE_GROUPS,
        {
          feature: "billing",
          vars: [
            "PADDLE_API_KEY",
            "PADDLE_CLIENT_TOKEN",
            "PADDLE_WEBHOOK_SECRET",
          ] as (keyof ServerEnv)[],
        },
      ]
    : FEATURE_GROUPS;
  for (const group of groups) {
    const missing = group.vars.filter((name) => parsed.data[name] === undefined);
    if (missing.length > 0)
      warnings.push(`${group.feature} disabled: missing ${missing.join(", ")}`);
  }
  return warnings;
}

// Minimal 5-field cron evaluation (UTC) for deriving expected run intervals from SCHEDULE.
// Supports `*`, numbers, ranges `a-b`, steps `*/n` / `a-b/n` and lists; node-cron only
// answers "next run from now", not "next run after a given time".

const MINUTE_MS = 60_000;

interface Field {
  min: number;
  max: number;
}

const FIELDS: Field[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 }, // day of week (0 and 7 are Sunday)
];

interface ParsedCron {
  sets: Set<number>[];
  domRestricted: boolean;
  dowRestricted: boolean;
}

function parseField(text: string, field: Field): Set<number> {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    let lo = field.min;
    let hi = field.max;
    if (range !== "*") {
      const [a, b] = range.split("-");
      lo = Number(a);
      hi = b === undefined ? (stepText === undefined ? lo : field.max) : Number(b);
    }
    if (![lo, hi, step].every(Number.isInteger) || step < 1 || lo < field.min || hi > field.max) {
      throw new Error(`invalid cron field: ${text}`);
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

const cache = new Map<string, ParsedCron>();

function parse(expression: string): ParsedCron {
  const cached = cache.get(expression);
  if (cached) return cached;
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`expected 5 cron fields: ${expression}`);
  const sets = parts.map((p, i) => parseField(p, FIELDS[i]));
  if (sets[4].has(7)) sets[4].add(0);
  const parsed = { sets, domRestricted: parts[2] !== "*", dowRestricted: parts[4] !== "*" };
  cache.set(expression, parsed);
  return parsed;
}

function matches(c: ParsedCron, d: Date): boolean {
  const [minute, hour, dom, month, dow] = c.sets;
  if (!minute.has(d.getUTCMinutes()) || !hour.has(d.getUTCHours())) return false;
  if (!month.has(d.getUTCMonth() + 1)) return false;
  const domOk = dom.has(d.getUTCDate());
  const dowOk = dow.has(d.getUTCDay());
  // Standard cron: when both day fields are restricted, either one matching is enough.
  if (c.domRestricted && c.dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}

/** The first fire time strictly after `after` (searches up to 366 days), or null. */
export function nextCronTime(expression: string, after: Date): Date | null {
  const c = parse(expression);
  let t = Math.floor(after.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const limit = t + 366 * 24 * 60 * MINUTE_MS;
  for (; t <= limit; t += MINUTE_MS) {
    if (matches(c, new Date(t))) return new Date(t);
  }
  return null;
}

const intervalCache = new Map<string, number>();
// A Monday, so weekly schedules get two fires inside the window.
const REFERENCE = Date.UTC(2026, 0, 5);

/** The longest gap between consecutive fires over a 15-day window. */
export function cronIntervalMs(expression: string): number {
  const cached = intervalCache.get(expression);
  if (cached !== undefined) return cached;
  const end = REFERENCE + 15 * 24 * 60 * MINUTE_MS;
  let prev = nextCronTime(expression, new Date(REFERENCE - MINUTE_MS));
  let longest = 0;
  while (prev && prev.getTime() < end) {
    const next = nextCronTime(expression, prev);
    if (!next) break;
    longest = Math.max(longest, next.getTime() - prev.getTime());
    prev = next;
  }
  if (longest === 0) throw new Error(`cron fires less than twice in 15 days: ${expression}`);
  intervalCache.set(expression, longest);
  return longest;
}

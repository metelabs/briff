// Minimal structured logger: one JSON line per event on stdout/stderr.
// Deliberately dependency-free so the esbuild-bundled worker has nothing to trace.

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const REDACTED_KEYS = /authorization|cookie|password|secret|token/i;

function threshold(): number {
  const configured = (process.env.LOG_LEVEL || "").toLowerCase();
  if (configured in ORDER) return ORDER[configured as Level];
  return process.env.NODE_ENV === "production" ? ORDER.info : ORDER.debug;
}

function serialise(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function redact(fields: Fields): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = REDACTED_KEYS.test(key) ? "[redacted]" : serialise(value);
  }
  return out;
}

export interface Logger {
  debug(fields: Fields, msg: string): void;
  info(fields: Fields, msg: string): void;
  warn(fields: Fields, msg: string): void;
  error(fields: Fields, msg: string): void;
  child(bindings: Fields): Logger;
}

function createLogger(bindings: Fields): Logger {
  const write = (level: Level, fields: Fields, msg: string) => {
    if (ORDER[level] < threshold()) return;
    const line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      msg,
      ...bindings,
      ...redact(fields),
    });
    if (ORDER[level] >= ORDER.warn) process.stderr.write(line + "\n");
    else process.stdout.write(line + "\n");
  };
  return {
    debug: (f, m) => write("debug", f, m),
    info: (f, m) => write("info", f, m),
    warn: (f, m) => write("warn", f, m),
    error: (f, m) => write("error", f, m),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const log = createLogger({ service: "briff" });

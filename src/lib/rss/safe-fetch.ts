import "server-only";

import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";

import { checkUrlSync, resolvePublicAddresses } from "./ssrf-guard";

// SSRF-safe fetch for the RSS read path. Unlike global fetch, this resolves the
// hostname, validates every resolved IP against the private/reserved ranges,
// and pins the connection to a validated address — closing the DNS-rebinding
// window where a name resolves public at add-time and private at read-time.
// Redirects are followed manually so the same check runs on every hop.

export interface SafeFetchResult {
  status: number;
  contentType: string;
  body: string;
  /** Validators for conditional requests (lower-cased header names). */
  etag: string | null;
  lastModified: string | null;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  retries?: number;
  retryBaseDelayMs?: number;
  headers?: Record<string, string>;
  /** POST sends `body` once per attempt and never follows a redirect (the 3xx is returned). */
  method?: "GET" | "POST";
  body?: string;
}

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 200;

export class SsrfBlockedError extends Error {}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

// Custom DNS lookup that only ever hands node an address we've validated as
// public. Pinning happens here: node connects to exactly this IP while the TLS
// SNI / Host header still carry the original hostname.
const safeLookup: LookupFunction = (hostname, options, callback) => {
  resolvePublicAddresses(hostname)
    .then((res) => {
      if (!res.ok) {
        callback(new SsrfBlockedError(`blocked host ${hostname}: ${res.reason}`), "", 0);
        return;
      }
      if (typeof options === "object" && options?.all) {
        callback(
          null,
          res.records.map((r) => ({ address: r.address, family: r.family })) as never,
          0 as never
        );
      } else {
        const first = res.records[0]!;
        callback(null, first.address, first.family);
      }
    })
    .catch((err) => callback(err as NodeJS.ErrnoException, "", 0));
};

interface RawResponse {
  status: number;
  location: string | null;
  contentType: string;
  body: string;
  etag: string | null;
  lastModified: string | null;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function decodeBody(res: Readable, encoding: string | undefined): Readable {
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return res.pipe(zlib.createGunzip());
    case "br":
      return res.pipe(zlib.createBrotliDecompress());
    case "deflate":
      return res.pipe(zlib.createInflate());
    default:
      return res;
  }
}

function requestOnce(
  target: URL,
  opts: Required<Pick<SafeFetchOptions, "timeoutMs" | "maxBytes">> & {
    headers: Record<string, string>;
    method: "GET" | "POST";
    body?: string;
  }
): Promise<RawResponse> {
  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      target,
      {
        method: opts.method,
        headers: {
          "Accept-Encoding": "gzip, deflate, br",
          ...(opts.body !== undefined
            ? { "Content-Length": String(Buffer.byteLength(opts.body)) }
            : {}),
          ...opts.headers,
        },
        lookup: safeLookup,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location ?? null;
        const contentType = (res.headers["content-type"] ?? "").toLowerCase();
        const etag = headerValue(res.headers.etag);
        const lastModified = headerValue(res.headers["last-modified"]);

        // Don't read the body of a redirect — we only need the Location header.
        if (location && status >= 300 && status < 400 && opts.method === "GET") {
          res.resume();
          resolve({ status, location, contentType, body: "", etag, lastModified });
          return;
        }

        // Some servers (sentry.io) compress even when not asked; decode so the
        // byte cap applies to the real body.
        const body = decodeBody(res, res.headers["content-encoding"]);
        const chunks: Buffer[] = [];
        let total = 0;
        body.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > opts.maxBytes) {
            res.destroy();
            body.destroy();
            resolve({
              status,
              location: null,
              contentType,
              body: Buffer.concat(chunks).subarray(0, opts.maxBytes).toString("utf-8"),
              etag,
              lastModified,
            });
            return;
          }
          chunks.push(chunk);
        });
        body.on("end", () => {
          resolve({
            status,
            location: null,
            contentType,
            body: Buffer.concat(chunks).toString("utf-8"),
            etag,
            lastModified,
          });
        });
        body.on("error", reject);
        if (body !== res) res.on("error", reject);
      }
    );

    req.setTimeout(opts.timeoutMs, () => req.destroy(new Error("safe-fetch: timeout")));
    req.on("error", reject);
    req.end(opts.body);
  });
}

export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    retries = DEFAULT_RETRIES,
    retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
    headers = {},
    method = "GET",
    body,
  } = options;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let current = rawUrl;
      for (let hop = 0; hop <= maxRedirects; hop++) {
        const sync = checkUrlSync(current);
        if (!sync.ok) throw new SsrfBlockedError(`blocked url: ${sync.reason}`);

        const res = await requestOnce(sync.url, { timeoutMs, maxBytes, headers, method, body });

        if (method === "GET" && res.location && res.status >= 300 && res.status < 400) {
          if (hop === maxRedirects) throw new Error("safe-fetch: too many redirects");
          current = new URL(res.location, sync.url).toString();
          continue;
        }

        if (isRetryableStatus(res.status) && attempt < retries) {
          lastError = new Error(`safe-fetch: HTTP ${res.status}`);
          break;
        }

        return {
          status: res.status,
          contentType: res.contentType,
          body: res.body,
          etag: res.etag,
          lastModified: res.lastModified,
        };
      }
    } catch (err) {
      // A blocked host is a terminal decision, never retry it.
      if (err instanceof SsrfBlockedError) throw err;
      lastError = err;
      if (attempt === retries) throw err;
    }

    await new Promise((r) => setTimeout(r, retryBaseDelayMs * 2 ** attempt));
  }

  throw lastError ?? new Error("safe-fetch: exhausted retries");
}

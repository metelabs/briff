import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { appJwt } from "./api";
import { parsePrivateKey } from "./config";

describe("parsePrivateKey", () => {
  const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string;

  it("accepts a literal PEM, one with escaped newlines, and base64", () => {
    expect(parsePrivateKey(pem)).toBe(pem.trim());
    expect(parsePrivateKey(pem.trim().replace(/\n/g, "\\n"))).toBe(pem.trim());
    expect(parsePrivateKey(Buffer.from(pem).toString("base64"))).toBe(pem.trim());
    expect(() => parsePrivateKey("not a key")).toThrow(/PEM/);
  });

  it("signs an app JWT with it", () => {
    const jwt = appJwt("42", parsePrivateKey(Buffer.from(pem).toString("base64")), new Date(0));
    const [, payload] = jwt.split(".");
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
      iat: -60,
      exp: 540,
      iss: "42",
    });
  });
});

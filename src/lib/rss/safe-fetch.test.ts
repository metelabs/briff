import { describe, expect, it } from "vitest";

import { safeFetch } from "./safe-fetch";

describe("safeFetch", () => {
  it("refuses private targets before connecting", async () => {
    await expect(safeFetch("http://127.0.0.1:9/feed")).rejects.toThrow(/blocked/);
    await expect(safeFetch("http://localhost/feed")).rejects.toThrow(/blocked/);
  });
});

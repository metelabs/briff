import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { OrgCapacityNotice } from "./org-capacity-notice";

describe("organisation limits notice", () => {
  it("shows both configured limits before the organisation reaches capacity", () => {
    const html = renderToStaticMarkup(
      createElement(OrgCapacityNotice, {
        capacity: { repos: 0, repoLimit: 7, streams: 1, streamLimit: 3 },
      })
    );
    expect(html).toContain('aria-label="Organisation limits"');
    expect(html).toContain("0 / 7 repositories · 1 / 3 streams");
    expect(html).toContain("Ask the instance admin");
  });
});

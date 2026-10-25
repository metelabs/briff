import { describe, it, expect } from "vitest";
import { parseRss } from "./parser";

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>My &amp; Feed</title>
  <item>
    <title>First &mdash; Post</title>
    <link>https://example.com/first</link>
    <guid>guid-1</guid>
    <pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate>
    <dc:creator>Jane Dev</dc:creator>
    <category>WebDev</category>
    <category>Rust</category>
    <enclosure url="https://example.com/img.png" type="image/png"/>
  </item>
  <item>
    <link>https://example.com/no-title</link>
    <guid>guid-2</guid>
    <pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Atom Item</title>
    <link href="https://example.com/atom"/>
    <id>atom-1</id>
    <updated>2026-06-01T00:00:00Z</updated>
  </entry>
</feed>`;

const REDDIT_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <category term="rust" label="r/rust"/>
  <title>rust</title>
  <entry>
    <author><name>/u/dev</name><uri>https://www.reddit.com/user/dev</uri></author>
    <category term="rust" label="r/rust"/>
    <content type="html">&lt;a href="x"&gt;body&lt;/a&gt;</content>
    <id>t3_abc123</id>
    <link href="https://out.example.com/self" rel="self"/>
    <link href="https://www.reddit.com/r/rust/comments/abc123/some_title/" rel="alternate"/>
    <updated>2026-07-18T10:00:00+00:00</updated>
    <published>2026-07-18T09:00:00+00:00</published>
    <title>Some Rust Post</title>
  </entry>
</feed>`;

describe("parseRss", () => {
  it("parses RSS 2.0 items, decodes entities, lowercases categories", () => {
    const feed = parseRss(RSS);
    expect(feed.title).toBe("My & Feed");
    expect(feed.items).toHaveLength(1); // the title-less item is dropped
    const item = feed.items[0];
    expect(item.title).toBe("First — Post");
    expect(item.link).toBe("https://example.com/first");
    expect(item.guid).toBe("guid-1");
    expect(item.author).toBe("Jane Dev");
    expect(item.categories).toEqual(["webdev", "rust"]);
    expect(item.thumbnail).toBe("https://example.com/img.png");
  });

  it("drops items missing a required field (no title)", () => {
    const feed = parseRss(RSS);
    expect(feed.items.find((i) => i.guid === "guid-2")).toBeUndefined();
  });

  it("falls back to Atom <entry> blocks with href links", () => {
    const feed = parseRss(ATOM);
    expect(feed.title).toBe("Atom Feed");
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].link).toBe("https://example.com/atom");
    expect(feed.items[0].guid).toBe("atom-1");
  });

  it("extracts body content from RSS description and Atom content", () => {
    const rss = `<rss><channel><title>X</title><item><title>T</title><link>https://e.com/1</link>
      <guid>1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <description><![CDATA[<p>Hello &amp; welcome</p>]]></description></item></channel></rss>`;
    expect(parseRss(rss).items[0].content).toBe("<p>Hello & welcome</p>");
    expect(parseRss(REDDIT_ATOM).items[0].content).toBe('<a href="x">body</a>');
    expect(parseRss(ATOM).items[0].content).toBeNull();
  });

  it("returns empty items for non-feed input", () => {
    expect(parseRss("<html>nope</html>").items).toEqual([]);
  });

  it("parses Reddit-style Atom: alternate link, atom author name, published date", () => {
    const feed = parseRss(REDDIT_ATOM);
    expect(feed.items).toHaveLength(1);
    const item = feed.items[0];
    // rel="alternate" wins over the rel="self" link that appears first.
    expect(item.link).toBe("https://www.reddit.com/r/rust/comments/abc123/some_title/");
    expect(item.guid).toBe("t3_abc123");
    expect(item.author).toBe("/u/dev");
    expect(item.publishedAt).toBe("2026-07-18T09:00:00+00:00");
    expect(item.categories).toContain("rust");
  });

  it("parses Blogger Atom with single-quoted attributes", () => {
    const blogger = `<feed xmlns='http://www.w3.org/2005/Atom'><title type='text'>Android</title>
      <entry><id>tag:blogger.com,1999:post-1</id><published>2026-10-13T10:00:00.000-07:00</published>
      <title type='text'>Play update</title>
      <link rel='replies' type='text/html' href='https://a.example/post#comment-form'/>
      <link rel='alternate' type='text/html' href='https://a.example/post' title='Play update'/>
      </entry></feed>`;
    const feed = parseRss(blogger);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].link).toBe("https://a.example/post");
  });

  it("drops items whose link uses a non-http(s) scheme (XSS guard)", () => {
    const malicious = `<rss><channel><title>X</title>
      <item><title>Evil</title><link>javascript:alert(1)</link><guid>evil-1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
      <item><title>Data</title><link>data:text/html,&lt;script&gt;</link><guid>evil-2</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
      <item><title>Good</title><link>https://example.com/ok</link><guid>ok-1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
    </channel></rss>`;
    const feed = parseRss(malicious);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].link).toBe("https://example.com/ok");
    expect(feed.items.some((i) => i.link.startsWith("javascript:"))).toBe(false);
  });
});

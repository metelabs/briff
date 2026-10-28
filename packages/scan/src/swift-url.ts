/** OSV SwiftURL names omit transport and .git; GitHub paths are case-insensitive. */
export function swiftPackageName(raw: string): string | null {
  const value = raw
    .trim()
    .replace(/^git\+/, "")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^git:\/\//, "https://");
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname.includes(".") ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    )
      return null;
    const path = url.pathname.replace(/\/+$/, "").replace(/\.git$/, "");
    if (!/^\/[A-Za-z0-9_.~/-]+$/.test(path) || path === "/") return null;
    return url.hostname === "github.com" || url.hostname === "www.github.com"
      ? `github.com${path.toLowerCase()}`
      : `${url.hostname}${path}`;
  } catch {
    return null;
  }
}

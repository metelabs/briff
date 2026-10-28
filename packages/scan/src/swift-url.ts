/** OSV SwiftURL names omit the transport and .git suffix, preserving path case. */
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
    return /^\/[A-Za-z0-9_.~/-]+$/.test(path) && path !== "/" ? `${url.hostname}${path}` : null;
  } catch {
    return null;
  }
}

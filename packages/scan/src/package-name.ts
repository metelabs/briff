/** Splits `name@version` where the name may be scoped (`@scope/name@1.0.0`). */
export function splitNameVersion(spec: string): { name: string; version: string } | null {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return null;
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  if (!name || !version) return null;
  return { name, version };
}

/** Versions that do not identify a registry release (links, workspaces, local files). */
export function isNonRegistryVersion(version: string): boolean {
  return /^(link:|file:|workspace:|portal:|patch:)/.test(version) || version === "0.0.0-use.local";
}

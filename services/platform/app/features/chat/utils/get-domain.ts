/**
 * Hostname of a URL for display, or the raw string when it can't be parsed.
 * Unlike `extractHostname` in format-tool-detail.ts, this keeps any leading
 * `www.` — citation and source chips show the host verbatim.
 */
export function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

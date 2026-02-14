/**
 * Validate that a URL's hostname is in the allowedHosts list.
 * Shared by HTTP request execution and file download operations.
 */

export function validateHost(url: string, allowedHosts: string[]): void {
  const parsed = new URL(url);
  const hostname = parsed.hostname;

  const isAllowed = allowedHosts.some((allowed) => {
    return hostname === allowed || hostname.endsWith('.' + allowed);
  });

  if (!isAllowed) {
    throw new Error(
      `HTTP request to "${hostname}" blocked: host not in allowedHosts [${allowedHosts.join(', ')}]`,
    );
  }
}

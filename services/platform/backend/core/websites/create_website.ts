/** The hostname a website registration names: a full URL (preferred) or a
 * bare domain, both read through `new URL()` so `www.` and paths normalize
 * the same way on every write door. */
export function toWebsiteDomain(input: string): string {
  return new URL(
    input.startsWith('http://') || input.startsWith('https://')
      ? input
      : `https://${input}`,
  ).hostname;
}

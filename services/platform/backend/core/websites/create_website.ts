import { parseCrawlTarget } from '../../../lib/net/crawl-host-policy';

/** The hostname a website registration names: a full http(s) URL
 * (preferred) or a bare domain, both read through `new URL()` so `www.`
 * and paths normalize the same way on every write door — and checked
 * against the crawl-target policy (`lib/net/crawl-host-policy.ts`): a
 * loopback, private-network or metadata host, or a non-http(s) scheme,
 * throws a `CrawlTargetError` the doors answer as 400. */
export function toWebsiteDomain(input: string): string {
  return parseCrawlTarget(input);
}

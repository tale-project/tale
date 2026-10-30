/**
 * Whether a website answered with a bot check — the page its bot protection
 * serves in place of the one asked for, which only a browser running the
 * check's script gets past — and whose check it is.
 *
 * Read as the page, a bot check says "A required part of this site couldn't
 * load…" or "Just a moment...", and a reader takes that for the site's
 * content. The verdict usually concerns the address the request came from,
 * so the same request through another outbound proxy may be served the page
 * itself.
 *
 * Recognized are the checks their vendors mark on the response — Cloudflare's
 * `cf-mitigated: challenge`, AWS WAF's `x-amzn-waf-action: challenge` or
 * `captcha`, Vercel's `x-vercel-mitigated: challenge` — and Fastly's "Client
 * Challenge", which marks nothing and is told by its own page: that title,
 * and the `/_fs-ch-` path its script and assets load from.
 */

export interface BotCheckResponse {
  readonly headers: Headers;
  readonly body: string;
}

const FASTLY_CHALLENGE_TITLE = /<title>\s*Client Challenge\s*<\/title>/i;
const FASTLY_CHALLENGE_ASSETS = '/_fs-ch-';

/** The vendor whose bot check `response` is, or null for any other answer. */
export function botCheckOf(response: BotCheckResponse): string | null {
  const header = (name: string): string =>
    response.headers.get(name)?.trim().toLowerCase() ?? '';
  if (header('cf-mitigated') === 'challenge') return 'Cloudflare';
  const wafAction = header('x-amzn-waf-action');
  if (wafAction === 'challenge' || wafAction === 'captcha') return 'AWS WAF';
  if (header('x-vercel-mitigated') === 'challenge') return 'Vercel';
  if (
    response.body.includes(FASTLY_CHALLENGE_ASSETS) &&
    FASTLY_CHALLENGE_TITLE.test(response.body)
  ) {
    return 'Fastly';
  }
  return null;
}

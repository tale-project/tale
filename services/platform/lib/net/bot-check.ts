/**
 * Whether a website answered with a bot check — the page its bot protection
 * serves in place of the one asked for — whose check it is, and what it asks
 * of the client.
 *
 * Read as the page, a bot check says "A required part of this site couldn't
 * load…" or "Just a moment...", and a reader takes that for the site's
 * content. The verdict usually concerns the address the request came from,
 * so the same request through another outbound proxy may be served the page
 * itself.
 *
 * A check asks one of three things. A challenge is a script that a browser
 * runs on its own and that reloads the page once it passes. A CAPTCHA is a
 * puzzle for a person to solve. A block refuses the request outright.
 *
 * Recognized are the checks their vendors mark on the response — Cloudflare's
 * `cf-mitigated: challenge` (its only value, whatever the challenge),
 * AWS WAF's `x-amzn-waf-action: challenge` or `captcha`, Vercel's
 * `x-vercel-mitigated: challenge` or `deny` — and the pages that carry no
 * mark: Fastly's "Client Challenge", told by that title and the `/_fs-ch-`
 * path its script and assets load from, and AWS WAF's interstitial, told by
 * the `window.gokuProps` it hands its script: the CAPTCHA draws a puzzle,
 * the challenge reloads the page once its script holds a token. The script's
 * address alone tells nothing: a page that loads AWS WAF's SDK to call its
 * own API (a TED notice loads `challenge.js` and `jsapi.js`) sets no
 * `gokuProps`, and is the page.
 */

export interface BotCheckResponse {
  readonly headers: Headers;
  readonly body: string;
}

/** What a bot check asks of the client. */
export type BotCheckKind = 'challenge' | 'captcha' | 'block';

export interface BotCheck {
  /** Whose bot protection answered: `Cloudflare`, `AWS WAF`, `Vercel`,
   * `Fastly`. */
  readonly vendor: string;
  readonly kind: BotCheckKind;
}

/** The headers the vendors mark a check with, for a reader that keeps only
 * these of a response (the render lane's browser). */
export const BOT_CHECK_HEADERS = [
  'cf-mitigated',
  'x-amzn-waf-action',
  'x-vercel-mitigated',
] as const;

const FASTLY_CHALLENGE_TITLE = /<title>\s*Client Challenge\s*<\/title>/i;
const FASTLY_CHALLENGE_ASSETS = '/_fs-ch-';

/** Where AWS WAF's interstitial hands its script the token context; no
 * other page sets it. */
const AWS_INTERSTITIAL_PROPS = /\bwindow\.gokuProps\s*=/;
/** The CAPTCHA interstitial draws its puzzle (`CaptchaScript.renderCaptcha`,
 * from `captcha.js`). It reloads the page too, once the puzzle is solved. */
const AWS_CAPTCHA_PUZZLE = /\brenderCaptcha\b|\/captcha\.js\b/;
/** The challenge interstitial reloads the page once its script holds a
 * token. */
const AWS_CHALLENGE_RELOAD = /\blocation\.reload\s*\(/;

/** The bot check `response` is, or null for any other answer. */
export function botCheckOf(response: BotCheckResponse): BotCheck | null {
  const header = (name: (typeof BOT_CHECK_HEADERS)[number]): string =>
    response.headers.get(name)?.trim().toLowerCase() ?? '';
  if (header('cf-mitigated') === 'challenge') {
    return { vendor: 'Cloudflare', kind: 'challenge' };
  }
  const wafAction = header('x-amzn-waf-action');
  if (wafAction === 'challenge' || wafAction === 'captcha') {
    return { vendor: 'AWS WAF', kind: wafAction };
  }
  const vercel = header('x-vercel-mitigated');
  if (vercel === 'challenge') return { vendor: 'Vercel', kind: 'challenge' };
  if (vercel === 'deny') return { vendor: 'Vercel', kind: 'block' };
  return botCheckPageOf(response.body);
}

/** The unmarked check `body` is: Fastly's page, or AWS WAF's interstitial. */
function botCheckPageOf(body: string): BotCheck | null {
  if (
    body.includes(FASTLY_CHALLENGE_ASSETS) &&
    FASTLY_CHALLENGE_TITLE.test(body)
  ) {
    return { vendor: 'Fastly', kind: 'challenge' };
  }
  if (!AWS_INTERSTITIAL_PROPS.test(body)) return null;
  if (AWS_CAPTCHA_PUZZLE.test(body)) {
    return { vendor: 'AWS WAF', kind: 'captcha' };
  }
  if (AWS_CHALLENGE_RELOAD.test(body)) {
    return { vendor: 'AWS WAF', kind: 'challenge' };
  }
  return null;
}

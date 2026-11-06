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
 * path its script and assets load from, and AWS WAF's interstitial. That one
 * is a page of about 2 KB, answered 202 for the challenge and 405 for the
 * CAPTCHA, whose own script sets the `window.gokuProps` the check's script
 * reads: the CAPTCHA draws a puzzle, the challenge reloads the page once its
 * script holds a token. The script's address alone tells nothing: a page
 * that loads AWS WAF's SDK to call its own API (a TED notice loads
 * `challenge.js` and `jsapi.js`) sets no `gokuProps`, and is the page. So is
 * a page that quotes the interstitial, as an article on bot protection does:
 * there its markup is text the page shows, not a script it runs.
 *
 * Cloudflare marks every check alike, whether its script passes on its own
 * or waits for a person to tick a box: which of them a visitor gets is
 * decided in the browser, and nothing in the first answer tells them apart
 * reliably. A Cloudflare check is a challenge here, then: a browser passes
 * it, or meets it again and reads nothing.
 */

/** What a check is read from of a response's headers: `Headers`, or the
 * headers a reader kept of one ({@link headerRecord}). */
export interface HeaderReader {
  get(name: string): string | null;
}

export interface BotCheckResponse {
  readonly status: number;
  readonly headers: HeaderReader;
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

/** The longest page taken for AWS WAF's interstitial: about 2 KB as served,
 * a little more once a browser has drawn it, and far below a page that
 * quotes it. */
const AWS_INTERSTITIAL_MAX_CHARS = 16_384;
/** Where AWS WAF's interstitial hands its script the token context; no
 * other page's script sets it. */
const AWS_INTERSTITIAL_PROPS = /\bwindow\.gokuProps\s*=/;
/** The CAPTCHA interstitial draws its puzzle (`CaptchaScript.renderCaptcha`,
 * from `captcha.js`). It reloads the page too, once the puzzle is solved. */
const AWS_CAPTCHA_PUZZLE = /\brenderCaptcha\b|\/captcha\.js\b/;
/** The challenge interstitial reloads the page once its script holds a
 * token. */
const AWS_CHALLENGE_RELOAD = /\blocation\.reload\s*\(/;

/** The bot check `response` is, or null for any other answer. */
export function botCheckOf(response: BotCheckResponse): BotCheck | null {
  return (
    markedBotCheckOf(response.headers) ??
    botCheckPageOf(response.status, response.body)
  );
}

/** The check a response's headers mark, or null: for a reader that kept the
 * headers alone, as of a render that ended on an error status. */
export function markedBotCheckOf(headers: HeaderReader): BotCheck | null {
  const header = (name: (typeof BOT_CHECK_HEADERS)[number]): string =>
    headers.get(name)?.trim().toLowerCase() ?? '';
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
  return null;
}

/** A record of header values, by lower-case name, read as a response's
 * headers. Unlike `new Headers(record)`, it takes a value of any characters:
 * one outside Latin-1 is no mark, never a throw. */
export function headerRecord(
  record: Readonly<Record<string, string>>,
): HeaderReader {
  return {
    get: (name) => {
      const key = name.toLowerCase();
      return Object.hasOwn(record, key) ? (record[key] ?? null) : null;
    },
  };
}

/** The unmarked check a page is: Fastly's page, or AWS WAF's interstitial. */
function botCheckPageOf(status: number, body: string): BotCheck | null {
  if (
    body.includes(FASTLY_CHALLENGE_ASSETS) &&
    FASTLY_CHALLENGE_TITLE.test(body)
  ) {
    return { vendor: 'Fastly', kind: 'challenge' };
  }
  if (
    (status !== 202 && status !== 405) ||
    body.length > AWS_INTERSTITIAL_MAX_CHARS ||
    !scriptCodeOf(body).some((code) => AWS_INTERSTITIAL_PROPS.test(code))
  ) {
    return null;
  }
  // A CAPTCHA is never taken for a challenge: what is not plainly the
  // challenge's reload, and is answered as the CAPTCHA is, stays one.
  if (status === 405 || AWS_CAPTCHA_PUZZLE.test(body)) {
    return { vendor: 'AWS WAF', kind: 'captcha' };
  }
  if (AWS_CHALLENGE_RELOAD.test(body)) {
    return { vendor: 'AWS WAF', kind: 'challenge' };
  }
  return null;
}

/** The code of every `<script>` element of `html`, in one pass: what the
 * page runs, never text it shows, which writes a tag as `&lt;script&gt;`.
 * A script left open at the end runs to the end. */
function scriptCodeOf(html: string): string[] {
  // `<scripts>` and `<script-x>` are other elements.
  const opening = /<script(?=[\s/>])/gi;
  const closing = /<\/script/gi;
  const codes: string[] = [];
  while (opening.exec(html) !== null) {
    const start = html.indexOf('>', opening.lastIndex);
    if (start === -1) break;
    closing.lastIndex = start + 1;
    const close = closing.exec(html);
    codes.push(html.slice(start + 1, close?.index ?? html.length));
    if (close === null) break;
    opening.lastIndex = closing.lastIndex;
  }
  return codes;
}

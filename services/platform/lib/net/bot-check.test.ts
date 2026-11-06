import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { botCheckOf, headerRecord, markedBotCheckOf } from './bot-check';

/** The parts of the page wiki.mozilla.org served a data-center proxy exit in
 * place of the article (2026-10-30), verbatim. */
const FASTLY_CLIENT_CHALLENGE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <link href="/_fs-ch-1T1wmsGaOgGaSxcX/assets/styles.css" rel="stylesheet" />
    <title>Client Challenge</title>
  </head>
  <body>
    <noscript>JavaScript is disabled in your browser.</noscript>
    <div id="loading-error" role="alert" aria-live="polite">
      A required part of this site couldn’t load. This may be due to a browser
      extension, network issues, or browser settings.
    </div>
    <script>loadScript('/_fs-ch-1T1wmsGaOgGaSxcX/errors.js');</script>
  </body>
</html>`;

/** AWS WAF's challenge interstitial as TED served it (2026-10-31), with its
 * key and script address replaced by placeholders. */
const AWS_WAF_CHALLENGE = readFileSync(
  join(import.meta.dirname, '../knowledge/fixtures/aws-waf-challenge.html.txt'),
  'utf8',
);

/** The shape of AWS WAF's CAPTCHA interstitial: the same token context, and
 * a puzzle drawn before the page reloads. */
const AWS_WAF_CAPTCHA = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Human Verification</title>
  <script type="text/javascript">
    window.awsWafCookieDomainList = [];
    window.gokuProps = { "key": "KEY", "iv": "IV", "context": "CONTEXT" };
  </script>
  <script src="https://PLACEHOLDER.token.awswaf.com/PLACEHOLDER/challenge.js"></script>
  <script src="https://PLACEHOLDER.captcha.awswaf.com/PLACEHOLDER/captcha.js"></script>
</head>
<body>
  <div id="captcha-container"></div>
  <script type="text/javascript">
    AwsWafIntegration.saveReferrer();
    window.addEventListener("load", function () {
      const container = document.querySelector("#captcha-container");
      CaptchaScript.renderCaptcha(container, async (voucher) => {
        await ChallengeScript.submitCaptcha(voucher);
        window.location.reload(true);
      });
    });
  </script>
</body>
</html>`;

/** The head of a TED notice once rendered (2026-11-05): the page loads AWS
 * WAF's SDK for its own API calls, and is the page. */
const AWS_WAF_SDK_ON_A_PAGE = `<!DOCTYPE html>
<html lang="de-DE"><head>
  <title>721788-2026 - Wettbewerb - TED</title>
  <script src="https://PLACEHOLDER.edge.sdk.awswaf.com/PLACEHOLDER/challenge.js"></script>
  <script src="https://PLACEHOLDER.edge.captcha-sdk.awswaf.com/PLACEHOLDER/jsapi.js"></script>
</head><body><main><h1>Wettbewerb</h1><p>Datenverarbeitungsdienste</p></main></body></html>`;

/** An article that quotes AWS WAF's challenge page in a code block, as a
 * write-up on bot protection does: the page's markup escaped, as text. */
const ARTICLE_QUOTING_THE_CHALLENGE = `<!DOCTYPE html>
<html lang="en"><head><title>What AWS WAF's challenge page does</title></head>
<body><main>
  <h1>What AWS WAF's challenge page does</h1>
  <p>A client without a token is answered 202, with this page:</p>
  <pre><code>${AWS_WAF_CHALLENGE.replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')}</code></pre>
  <p>Its script reloads the page once it holds a token.</p>
</main></body></html>`;

const page = (
  body: string,
  headers: Record<string, string> = {},
  status = 200,
) => ({
  status,
  headers: new Headers({ 'content-type': 'text/html', ...headers }),
  body,
});

describe('botCheckOf', () => {
  it("recognizes Fastly's Client Challenge by its own page", () => {
    expect(botCheckOf(page(FASTLY_CLIENT_CHALLENGE))).toEqual({
      vendor: 'Fastly',
      kind: 'challenge',
    });
  });

  it.each([
    ['Cloudflare', 'challenge', { 'cf-mitigated': 'challenge' }],
    ['AWS WAF', 'challenge', { 'x-amzn-waf-action': 'challenge' }],
    ['AWS WAF', 'captcha', { 'x-amzn-waf-action': 'captcha' }],
    ['Vercel', 'challenge', { 'x-vercel-mitigated': 'challenge' }],
    ['Vercel', 'challenge', { 'x-vercel-mitigated': ' Challenge ' }],
    ['Vercel', 'block', { 'x-vercel-mitigated': 'deny' }],
  ])(
    'recognizes a %s %s by the header it marks the check with',
    (vendor, kind, headers) => {
      expect(
        botCheckOf(
          page('<html><title>Just a moment...</title></html>', headers),
        ),
      ).toEqual({ vendor, kind });
    },
  );

  it("recognizes AWS WAF's challenge by its interstitial when no header marks it", () => {
    expect(botCheckOf(page(AWS_WAF_CHALLENGE, {}, 202))).toEqual({
      vendor: 'AWS WAF',
      kind: 'challenge',
    });
    // A letter that lengthens in lower case ahead of the script moves
    // nothing: the script's code is read where it stands.
    const lengthening = AWS_WAF_CHALLENGE.replace(
      '<title></title>',
      `<title>${'İ'.repeat(200)}</title>`,
    );
    expect(botCheckOf(page(lengthening, {}, 202))).toEqual({
      vendor: 'AWS WAF',
      kind: 'challenge',
    });
  });

  it("tells AWS WAF's CAPTCHA from its challenge by the puzzle it draws", () => {
    expect(botCheckOf(page(AWS_WAF_CAPTCHA, {}, 405))).toEqual({
      vendor: 'AWS WAF',
      kind: 'captcha',
    });
    // The header decides first: a CAPTCHA page marked as one stays one.
    expect(
      botCheckOf(
        page(AWS_WAF_CAPTCHA, { 'x-amzn-waf-action': 'captcha' }, 405),
      ),
    ).toEqual({ vendor: 'AWS WAF', kind: 'captcha' });
    // Answered as the CAPTCHA is, an interstitial is one, whatever it draws.
    expect(botCheckOf(page(AWS_WAF_CHALLENGE, {}, 405))).toEqual({
      vendor: 'AWS WAF',
      kind: 'captcha',
    });
  });

  it.each([
    ['an ordinary page', page('<html><title>Release Calendar</title></html>')],
    [
      'a page titled like the check, without its assets',
      page('<html><title>Client Challenge</title><p>A puzzle.</p></html>'),
    ],
    [
      'a page that only links to the check',
      page('<a href="/_fs-ch-docs">How the client challenge works</a>'),
    ],
    ["a page that loads AWS WAF's SDK", page(AWS_WAF_SDK_ON_A_PAGE)],
    [
      'a page that writes about gokuProps without reloading',
      page('<pre>window.gokuProps = { "key": "…" }</pre>'),
    ],
    [
      "an article that quotes AWS WAF's challenge page",
      page(ARTICLE_QUOTING_THE_CHALLENGE),
    ],
    [
      "an article that quotes AWS WAF's challenge page, answered 202",
      page(ARTICLE_QUOTING_THE_CHALLENGE, {}, 202),
    ],
    [
      "AWS WAF's challenge page answered as a page is, 200",
      page(AWS_WAF_CHALLENGE),
    ],
    [
      "a long page whose own script holds AWS WAF's interstitial",
      page(
        `${AWS_WAF_CHALLENGE}<main>${'<p>Opening hours and prices.</p>'.repeat(600)}</main>`,
        {},
        202,
      ),
    ],
    [
      'a header value Cloudflare does not send',
      page('<html><title>Forbidden</title></html>', {
        'cf-mitigated': 'block',
      }),
    ],
    [
      'a mitigation header AWS WAF does not send',
      page('', { 'x-amzn-waf-action': 'block' }),
    ],
  ])('takes %s for the page itself', (_label, response) => {
    expect(botCheckOf(response)).toBeNull();
  });
});

describe('markedBotCheckOf', () => {
  it('reads the check a render kept the headers of', () => {
    expect(
      markedBotCheckOf(headerRecord({ 'x-amzn-waf-action': 'captcha' })),
    ).toEqual({ vendor: 'AWS WAF', kind: 'captcha' });
    expect(
      markedBotCheckOf(headerRecord({ 'cf-mitigated': 'challenge' })),
    ).toEqual({ vendor: 'Cloudflare', kind: 'challenge' });
  });

  it('takes a value outside Latin-1 for no mark, where Headers would throw', () => {
    const record = { 'cf-mitigated': 'challenge\u20ac' };
    expect(() => new Headers(record)).toThrow();
    expect(markedBotCheckOf(headerRecord(record))).toBeNull();
    expect(
      botCheckOf({
        status: 200,
        headers: headerRecord(record),
        body: '<html><title>Report</title></html>',
      }),
    ).toBeNull();
  });
});

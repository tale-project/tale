import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { botCheckOf } from './bot-check';

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

const page = (body: string, headers: Record<string, string> = {}) => ({
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
    expect(botCheckOf(page(AWS_WAF_CHALLENGE))).toEqual({
      vendor: 'AWS WAF',
      kind: 'challenge',
    });
  });

  it("tells AWS WAF's CAPTCHA from its challenge by the puzzle it draws", () => {
    expect(botCheckOf(page(AWS_WAF_CAPTCHA))).toEqual({
      vendor: 'AWS WAF',
      kind: 'captcha',
    });
    // The header decides first: a CAPTCHA page marked as one stays one.
    expect(
      botCheckOf(page(AWS_WAF_CAPTCHA, { 'x-amzn-waf-action': 'captcha' })),
    ).toEqual({ vendor: 'AWS WAF', kind: 'captcha' });
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

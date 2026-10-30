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

const page = (body: string, headers: Record<string, string> = {}) => ({
  headers: new Headers({ 'content-type': 'text/html', ...headers }),
  body,
});

describe('botCheckOf', () => {
  it("recognizes Fastly's Client Challenge by its own page", () => {
    expect(botCheckOf(page(FASTLY_CLIENT_CHALLENGE))).toBe('Fastly');
  });

  it.each([
    ['Cloudflare', { 'cf-mitigated': 'challenge' }],
    ['AWS WAF', { 'x-amzn-waf-action': 'challenge' }],
    ['AWS WAF', { 'x-amzn-waf-action': 'captcha' }],
    ['Vercel', { 'x-vercel-mitigated': 'challenge' }],
    ['Vercel', { 'x-vercel-mitigated': ' Challenge ' }],
  ])('recognizes %s by the header it marks a check with', (vendor, headers) => {
    expect(
      botCheckOf(page('<html><title>Just a moment...</title></html>', headers)),
    ).toBe(vendor);
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
    [
      'a block that is no check',
      page('<html><title>Forbidden</title></html>', {
        'cf-mitigated': 'block',
      }),
    ],
    [
      'a mitigation header with no check in it',
      page('', { 'x-amzn-waf-action': 'block' }),
    ],
  ])('takes %s for the page itself', (_label, response) => {
    expect(botCheckOf(response)).toBeNull();
  });
});

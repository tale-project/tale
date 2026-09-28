import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

import { detectIsIOS } from '@/app/hooks/use-display-mode';

/**
 * The pre-hydration script in `index.html` caps `maximum-scale` on iOS so
 * WebKit stops auto-zooming the page when a focused input's text is under
 * 16px — deliberately compact text (a dense table, an inline-rename field)
 * included, with no per-component font-size floor needed. It must fire for
 * EVERY iOS browser (they all embed WebKit) and NEVER on Android, where
 * `maximum-scale` also caps the user's own pinch-zoom — capping it there
 * would break WCAG 1.4.4. These tests run the inline script, as parsed,
 * against the same user agents `detectIsIOS` sees.
 */

// A path string, not `new URL(…)`: under jsdom the global URL is jsdom's,
// which node:fs does not accept.
const indexHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../index.html'),
  'utf8',
);
const zoomScript = (() => {
  const scripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const script = scripts.find((match) =>
    match[1]?.includes("getElementById('viewport-meta')"),
  );
  if (script?.[1] === undefined) {
    throw new Error('index.html has no iOS zoom-guard pre-hydration script');
  }
  return script[1];
})();

const ORIGINAL_CONTENT =
  'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content';

const USER_AGENTS = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.46 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  desktopSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
} as const;

function contentAfterScript(userAgent: string): string | null {
  const dom = new JSDOM(
    `<!doctype html><html><head><meta id="viewport-meta" name="viewport" content="${ORIGINAL_CONTENT}" /><script>${zoomScript}</script></head><body></body></html>`,
    {
      url: 'http://localhost/dashboard/org-1/chat',
      runScripts: 'dangerously',
      // Before parsing, so the inline script reads this user agent.
      beforeParse(window) {
        Object.defineProperty(window.navigator, 'userAgent', {
          value: userAgent,
          configurable: true,
        });
      },
    },
  );
  return (
    dom.window.document
      .getElementById('viewport-meta')
      ?.getAttribute('content') ?? null
  );
}

const originalUserAgent = window.navigator.userAgent;

afterEach(() => {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: originalUserAgent,
    configurable: true,
  });
});

describe('index.html iOS zoom-guard script', () => {
  it('caps maximum-scale for Mobile Safari', () => {
    expect(contentAfterScript(USER_AGENTS.iphoneSafari)).toBe(
      `${ORIGINAL_CONTENT}, maximum-scale=1`,
    );
  });

  it('caps maximum-scale for Chrome on iOS too — same WebKit engine', () => {
    expect(contentAfterScript(USER_AGENTS.iphoneChrome)).toBe(
      `${ORIGINAL_CONTENT}, maximum-scale=1`,
    );
  });

  it('leaves Android Chrome untouched — capping there would block pinch-zoom', () => {
    expect(contentAfterScript(USER_AGENTS.androidChrome)).toBe(
      ORIGINAL_CONTENT,
    );
  });

  it('leaves desktop Safari untouched', () => {
    expect(contentAfterScript(USER_AGENTS.desktopSafari)).toBe(
      ORIGINAL_CONTENT,
    );
  });

  it.each(Object.entries(USER_AGENTS))(
    'agrees with detectIsIOS for %s',
    (_name, userAgent) => {
      const capped = contentAfterScript(userAgent) !== ORIGINAL_CONTENT;
      Object.defineProperty(window.navigator, 'userAgent', {
        value: userAgent,
        configurable: true,
      });
      expect(capped).toBe(detectIsIOS());
    },
  );
});

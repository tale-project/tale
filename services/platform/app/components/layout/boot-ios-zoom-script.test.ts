import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

/** The viewport cap is safe for manual pinch zoom only in Safari's browser
 * shell from iOS 10 onward. Embedded WKWebViews and other iOS browsers may
 * honor the cap; these cases must retain the original viewport content. */

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

interface BrowserFixture {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  displayModeStandalone?: boolean;
}

function contentAfterScript(fixture: BrowserFixture): string | null {
  const dom = new JSDOM(
    `<!doctype html><html><head><meta id="viewport-meta" name="viewport" content="${ORIGINAL_CONTENT}" /><script>${zoomScript}</script></head><body></body></html>`,
    {
      url: 'http://localhost/dashboard/org-1/chat',
      runScripts: 'dangerously',
      beforeParse(window) {
        Object.defineProperties(window.navigator, {
          userAgent: { value: fixture.userAgent, configurable: true },
          platform: { value: fixture.platform ?? 'iPhone', configurable: true },
          maxTouchPoints: {
            value: fixture.maxTouchPoints ?? 1,
            configurable: true,
          },
          standalone: {
            value: fixture.standalone ?? false,
            configurable: true,
          },
        });
        Object.defineProperty(window, 'matchMedia', {
          value: () => ({ matches: fixture.displayModeStandalone ?? false }),
          configurable: true,
        });
      },
    },
  );
  try {
    return (
      dom.window.document
        .getElementById('viewport-meta')
        ?.getAttribute('content') ?? null
    );
  } finally {
    dom.window.close();
  }
}

describe('index.html Safari focus-zoom guard', () => {
  it.each<[string, BrowserFixture]>([
    ['iPhone Safari', { userAgent: USER_AGENTS.iphoneSafari }],
    [
      'iOS 10 Safari',
      {
        userAgent: USER_AGENTS.iphoneSafari.replace(
          'Version/18.0',
          'Version/10.0',
        ),
      },
    ],
    [
      'iPadOS desktop user agent',
      {
        userAgent: USER_AGENTS.desktopSafari,
        platform: 'MacIntel',
        maxTouchPoints: 5,
      },
    ],
  ])('caps automatic focus zoom for %s', (_name, fixture) => {
    expect(contentAfterScript(fixture)).toBe(
      `${ORIGINAL_CONTENT}, maximum-scale=1`,
    );
  });

  it.each<[string, BrowserFixture]>([
    [
      'a host-app user agent',
      { userAgent: `${USER_AGENTS.iphoneSafari} SyntheticHost/1.0` },
    ],
    ['Chrome on iOS', { userAgent: USER_AGENTS.iphoneChrome }],
    [
      'Firefox on iOS',
      { userAgent: USER_AGENTS.iphoneChrome.replace('CriOS', 'FxiOS') },
    ],
    [
      'Edge on iOS',
      { userAgent: USER_AGENTS.iphoneChrome.replace('CriOS', 'EdgiOS') },
    ],
    [
      'embedded WKWebView',
      {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      },
    ],
    [
      'an unknown Safari-like shell',
      { userAgent: USER_AGENTS.iphoneSafari.replace('Version/18.0 ', '') },
    ],
    [
      'Safari before iOS 10',
      {
        userAgent: USER_AGENTS.iphoneSafari.replace(
          'Version/18.0',
          'Version/9.0',
        ),
      },
    ],
    [
      'Android Chrome',
      { userAgent: USER_AGENTS.androidChrome, platform: 'Linux armv8l' },
    ],
    [
      'desktop Safari',
      {
        userAgent: USER_AGENTS.desktopSafari,
        platform: 'MacIntel',
        maxTouchPoints: 0,
      },
    ],
    [
      'installed app (navigator)',
      { userAgent: USER_AGENTS.iphoneSafari, standalone: true },
    ],
    [
      'installed app (display mode)',
      { userAgent: USER_AGENTS.iphoneSafari, displayModeStandalone: true },
    ],
  ])('preserves manual zoom settings for %s', (_name, fixture) => {
    expect(contentAfterScript(fixture)).toBe(ORIGINAL_CONTENT);
  });
});

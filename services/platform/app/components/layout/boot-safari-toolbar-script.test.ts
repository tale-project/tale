import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

import {
  detectIsMobileSafari,
  detectIsStandalone,
} from '@/app/hooks/use-display-mode';

/**
 * The boot shell's mobile tab-bar placeholder reserves the Safari toolbar
 * clearance from a class the pre-hydration script in `index.html` sets, while
 * the live bar decides it with `useDisplayMode`. Both must answer the same
 * question the same way, or the composer above the bar moves when the live
 * bar replaces the placeholder. These tests run the inline script, as parsed,
 * against the same user agents the hook sees.
 */

// A path string, not `new URL(…)`: under jsdom the global URL is jsdom's,
// which node:fs does not accept.
const indexHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../index.html'),
  'utf8',
);
const safariScript = (() => {
  const scripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const script = scripts.find((match) =>
    match[1]?.includes("'boot-safari-toolbar'"),
  );
  if (script?.[1] === undefined) {
    throw new Error('index.html has no Safari toolbar pre-hydration script');
  }
  return script[1];
})();

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

function markedByScript(userAgent: string, standalone: boolean): boolean {
  const dom = new JSDOM(
    `<!doctype html><html><head><script>${safariScript}</script></head><body></body></html>`,
    {
      url: 'http://localhost/dashboard/org-1/chat',
      runScripts: 'dangerously',
      // Before parsing, so the inline script reads this user agent.
      beforeParse(window) {
        Object.defineProperty(window.navigator, 'userAgent', {
          value: userAgent,
          configurable: true,
        });
        Object.defineProperty(window.navigator, 'standalone', {
          value: standalone,
          configurable: true,
        });
      },
    },
  );
  return dom.window.document.documentElement.classList.contains(
    'boot-safari-toolbar',
  );
}

function clearanceByHook(userAgent: string, standalone: boolean): boolean {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'standalone', {
    value: standalone,
    configurable: true,
  });
  return detectIsMobileSafari() && !detectIsStandalone();
}

const originalUserAgent = window.navigator.userAgent;

afterEach(() => {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: originalUserAgent,
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'standalone', {
    value: undefined,
    configurable: true,
  });
});

describe('index.html Safari toolbar marker', () => {
  it('marks Mobile Safari in a browser tab, where the bar adds clearance', () => {
    expect(markedByScript(USER_AGENTS.iphoneSafari, false)).toBe(true);
  });

  it('does not mark an installed app, which uses the safe-area inset', () => {
    expect(markedByScript(USER_AGENTS.iphoneSafari, true)).toBe(false);
  });

  it.each(Object.entries(USER_AGENTS))(
    'agrees with useDisplayMode for %s',
    (_name, userAgent) => {
      for (const standalone of [false, true]) {
        expect(markedByScript(userAgent, standalone)).toBe(
          clearanceByHook(userAgent, standalone),
        );
      }
    },
  );
});

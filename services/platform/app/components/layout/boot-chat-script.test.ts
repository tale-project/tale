import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import {
  dataNoticeBootKey,
  toCssString,
} from '@/app/features/governance/lib/data-notice-boot';

/**
 * The pre-hydration script in `index.html` decides, before any JS bundle or
 * stylesheet loads, which chat placeholders the served boot shell reveals.
 * These tests parse a document carrying that exact inline script — run by the
 * parser, as in the browser — against a URL and the stored state the app
 * writes, so the script and the app's storage contract cannot drift apart.
 */

// A path string, not `new URL(…)`: under jsdom the global URL is jsdom's,
// which node:fs does not accept.
const indexHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../index.html'),
  'utf8',
);
const bootChatScript = (() => {
  const scripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const script = scripts.find((match) => match[1]?.includes("'boot-chat'"));
  if (script?.[1] === undefined) {
    throw new Error('index.html has no boot-chat pre-hydration script');
  }
  return script[1];
})();

/** The `<html>` element after parsing the boot script at `pathname`. */
function bootAt(pathname: string, stored: Record<string, string> = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head><script>${bootChatScript}</script></head><body></body></html>`,
    {
      url: `http://localhost${pathname}`,
      runScripts: 'dangerously',
      beforeParse(window) {
        for (const [key, value] of Object.entries(stored)) {
          window.localStorage.setItem(key, value);
        }
      },
    },
  );
  return dom.window.document.documentElement;
}

describe('index.html boot-chat script', () => {
  it('reserves the notice row with the remembered text on a chat route', () => {
    const value = toCssString('Mind the client data.');

    const root = bootAt('/dashboard/org-1/chat', {
      [dataNoticeBootKey('org-1')]: value,
    });

    expect(root.classList.contains('boot-chat')).toBe(true);
    expect(root.classList.contains('boot-chat-notice')).toBe(true);
    expect(root.style.getPropertyValue('--boot-chat-notice')).toBe(value);
  });

  it('reserves nothing when this device never saw the org show a notice', () => {
    const root = bootAt('/dashboard/org-1/chat');

    expect(root.classList.contains('boot-chat')).toBe(true);
    expect(root.classList.contains('boot-chat-notice')).toBe(false);
  });

  it('reads only the navigated org', () => {
    const root = bootAt('/dashboard/org-1/chat', {
      [dataNoticeBootKey('org-2')]: toCssString('Another org'),
    });

    expect(root.classList.contains('boot-chat-notice')).toBe(false);
  });

  it('leaves non-chat routes untouched', () => {
    const root = bootAt('/dashboard/org-1/projects', {
      [dataNoticeBootKey('org-1')]: toCssString('Mind the client data.'),
    });

    expect(root.classList.contains('boot-chat')).toBe(false);
    expect(root.classList.contains('boot-chat-notice')).toBe(false);
  });
});

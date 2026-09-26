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

  it('reserves the Home panel on every Home route', () => {
    for (const path of [
      '/dashboard/org-1',
      '/dashboard/org-1/chat',
      '/dashboard/org-1/chat/thread-1',
      '/dashboard/org-1/home',
      '/dashboard/org-1/projects',
      '/dashboard/org-1/projects/p-1/tasks/board',
      '/dashboard/org-1/projects/p-1/automations',
      '/dashboard/org-1/tasks/t-1',
      '/dashboard/org-1/conversations/open',
    ]) {
      expect(
        bootAt(path).classList.contains('boot-home-panel-open'),
        path,
      ).toBe(true);
    }
  });

  it("leaves a project's automation workbench without the panel", () => {
    for (const path of [
      '/dashboard/org-1/projects/p-1/automations/intake',
      '/dashboard/org-1/projects/p-1/automations/intake/editor',
    ]) {
      expect(
        bootAt(path).classList.contains('boot-home-panel-open'),
        path,
      ).toBe(false);
    }
  });

  it('keeps a folded panel folded on the pages that can unfold it', () => {
    const folded = { 'chat-history-panel-open-org-1': 'false' };
    for (const path of [
      '/dashboard/org-1/chat',
      '/dashboard/org-1/tasks/t-1',
      '/dashboard/org-1/conversations/open?conversation=c-1',
    ]) {
      expect(
        bootAt(path, folded).classList.contains('boot-home-panel-open'),
        path,
      ).toBe(false);
    }
    // A project or the inbox index has no toggle to bring it back, so the
    // panel shows there whatever was stored.
    for (const path of [
      '/dashboard/org-1/projects/p-1/tasks/board',
      '/dashboard/org-1/conversations/open',
    ]) {
      expect(
        bootAt(path, folded).classList.contains('boot-home-panel-open'),
        path,
      ).toBe(true);
    }
  });

  it('keeps the chat composer to chat routes', () => {
    expect(
      bootAt('/dashboard/org-1/tasks/t-1').classList.contains('boot-chat'),
    ).toBe(false);
    expect(
      bootAt('/dashboard/org-1/chat/thread-1').classList.contains('boot-chat'),
    ).toBe(true);
  });

  it('reserves nothing outside Home or on a shared-chat snapshot', () => {
    for (const path of [
      '/dashboard/org-1/documents',
      '/dashboard/org-1/automations',
      '/dashboard/org-1/settings/account',
      '/dashboard/org-1/chat/shared/token-1',
      '/dashboard/switching',
      '/dashboard/create-organization',
      '/dashboard/changelog',
    ]) {
      const root = bootAt(path);
      expect(root.classList.contains('boot-home-panel-open'), path).toBe(false);
      expect(root.classList.contains('boot-chat'), path).toBe(false);
    }
  });

  it('leaves non-chat routes untouched', () => {
    const root = bootAt('/dashboard/org-1/projects', {
      [dataNoticeBootKey('org-1')]: toCssString('Mind the client data.'),
    });

    expect(root.classList.contains('boot-chat')).toBe(false);
    expect(root.classList.contains('boot-chat-notice')).toBe(false);
  });
});

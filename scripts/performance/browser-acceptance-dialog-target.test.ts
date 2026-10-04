import { afterEach, expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { JSDOM } from 'jsdom';

import { acceptanceDialogTargets } from './browser/acceptance-dialog-target.ts';

const require = createRequire(import.meta.url);
const driverRoot = dirname(require.resolve('playwright-core'));
const driver = require(join(driverRoot, 'package.json')) as {
  version: string;
};
const injected = require(
  join(driverRoot, 'lib/generated/injectedScriptSource.js'),
) as { source: string };
const owned: JSDOM[] = [];
afterEach(() => {
  for (const dom of owned.splice(0)) dom.window.close();
});

class FixtureLocator {
  constructor(readonly read: () => Element[]) {}
  and(other: FixtureLocator) {
    return new FixtureLocator(() => {
      const matches = new Set(other.read());
      return this.read().filter((element) => matches.has(element));
    });
  }
  async count() {
    return this.read().length;
  }
}

/** The actual pinned role engine owns accessibility filtering; the facade
 * supplies only locator composition. No browser, pixels or timing are tested. */
function fixture() {
  expect(driver.version).toBe('1.58.2');
  const dom = new JSDOM(
    '<main><div role="region"><section><button class="line-clamp-2">Owned task</button></section></div></main>',
    { runScripts: 'outside-only' },
  );
  owned.push(dom);
  // The fixture has no pseudo-element content. JSDOM does not implement the
  // pseudo argument; regular computed styles still drive the real role engine.
  const getStyle = dom.window.getComputedStyle.bind(dom.window);
  dom.window.getComputedStyle = (element) => getStyle(element);
  Object.defineProperty(dom.window, 'module', { value: { exports: {} } });
  const engine = dom.window.eval(
    `(() => {${injected.source}\nreturn createRoleEngine(true);})()`,
  ) as { queryAll: (root: Document, selector: string) => Element[] };
  const doc = dom.window.document;
  const page = {
    locator: (selector: string) =>
      new FixtureLocator(() => [...doc.querySelectorAll(selector)]),
    getByRole: (
      role: string,
      options: { name?: string; exact?: boolean; includeHidden?: boolean } = {},
    ) => {
      const name =
        options.name === undefined
          ? ''
          : `[name=${JSON.stringify(options.name)}${options.exact ? 's' : 'i'}]`;
      const hidden = options.includeHidden ? '[include-hidden=true]' : '';
      return new FixtureLocator(() =>
        engine.queryAll(doc, `${role}${name}${hidden}`),
      );
    },
  } as unknown as Parameters<typeof acceptanceDialogTargets>[0];
  const opener = doc.querySelector('button');
  const background = doc.querySelector('main');
  assert(opener && background);
  const open = (title = 'Owned task') => {
    background.setAttribute('aria-hidden', 'true');
    const dialog = doc.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', title);
    doc.body.append(dialog);
    return dialog;
  };
  return {
    doc,
    page,
    opener,
    background,
    open,
    targets: acceptanceDialogTargets(page, 'Owned task'),
  };
}

test('close owns a modal-hidden opener while the old accessible-card predicate fails', async () => {
  const f = fixture();
  await f.targets.assertPrecondition(true);
  expect(await f.targets.card.count()).toBe(1);
  f.open();
  expect(await f.targets.card.count()).toBe(0);
  await expect(
    (async () =>
      assert.equal(
        await f.targets.card.count(),
        1,
        'Dialog target is ambiguous',
      ))(),
  ).rejects.toThrow('Dialog target is ambiguous');
  await f.targets.assertPrecondition(false);
  expect(await f.targets.dialog.count()).toBe(1);
  // No global includeHidden relaxation: an open action still rejects this state.
  await expect(f.targets.assertPrecondition(true)).rejects.toThrow();
});

test('close rejects absent, wrong or ambiguous background opener identities', async () => {
  for (const mode of ['absent', 'wrong', 'duplicate']) {
    const f = fixture();
    f.open();
    if (mode === 'absent') f.opener.remove();
    else if (mode === 'wrong') f.opener.textContent = 'Other task';
    else f.opener.parentElement?.append(f.opener.cloneNode(true));
    await expect(f.targets.assertPrecondition(false)).rejects.toThrow(
      'Dialog target is ambiguous',
    );
  }
});

test('close also requires the exact visible owned dialog', async () => {
  for (const mode of ['absent', 'wrong', 'duplicate', 'hidden']) {
    const f = fixture();
    const dialog = f.open(mode === 'wrong' ? 'Other task' : 'Owned task');
    if (mode === 'absent') dialog.remove();
    if (mode === 'duplicate') f.doc.body.append(dialog.cloneNode(true));
    if (mode === 'hidden') dialog.setAttribute('aria-hidden', 'true');
    await expect(f.targets.assertPrecondition(false)).rejects.toThrow(
      'Close must own the open target',
    );
  }
});

test('open rejects an unrelated existing modal even with an accessible card', async () => {
  const f = fixture();
  f.open('Other task');
  f.background.removeAttribute('aria-hidden');
  await expect(f.targets.assertPrecondition(true)).rejects.toThrow(
    'Open predicate must start false',
  );
});

test('post-exit opener remains an accessible locator after modal isolation is removed', async () => {
  const f = fixture();
  const dialog = f.open();
  await f.targets.assertPrecondition(false);
  dialog.remove();
  expect(await f.targets.card.count()).toBe(0);
  f.background.removeAttribute('aria-hidden');
  f.opener.focus();
  expect(await f.targets.card.count()).toBe(1);
  expect(f.doc.activeElement).toBe(f.opener);
  await f.targets.assertPrecondition(true);
});

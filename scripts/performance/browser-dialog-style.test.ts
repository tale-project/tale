import { afterEach, expect, test } from 'bun:test';
import { createHash, webcrypto } from 'node:crypto';

import { JSDOM } from 'jsdom';

import { snapshotDialogStyle } from './browser/dialog-style.ts';

const owned: JSDOM[] = [];
afterEach(() => {
  for (const dom of owned.splice(0)) dom.window.close();
});
function fixture() {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div role="region"><section><button aria-label="Assign" class="same" data-state="closed">SECRET PERSON</button><button aria-label="Assign" class="same" data-state="closed">ANOTHER PERSON</button><button aria-label="Priority" data-state="closed"></button></section></div></body></html>',
    { runScripts: 'outside-only', url: 'https://synthetic.invalid' },
  );
  owned.push(dom);
  Object.assign(dom.window, { TextEncoder });
  Object.defineProperty(dom.window, 'crypto', { value: webcrypto });
  const run = dom.window.eval(
    `(${snapshotDialogStyle.toString()})`,
  ) as typeof snapshotDialogStyle;
  return { dom, run, document: dom.window.document };
}

test('serialized inventory aggregates exact triggers without text, URLs, values, IDs or unknown attributes', async () => {
  const f = fixture();
  const button = f.document.querySelector('button')!;
  button.setAttribute('data-secret', 'SECRET TOKEN');
  button.setAttribute('id', 'SECRET ID');
  button.setAttribute('onclick', 'SECRET HANDLER');
  button.setAttribute('value', 'SECRET VALUE');
  button.setAttribute('aria-controls', 'SECRET GENERATED ID');
  f.document.body.setAttribute(
    'style',
    'background-image:url(https://secret.invalid/key);pointer-events:none',
  );
  f.document.head.insertAdjacentHTML(
    'beforeend',
    '<link rel="stylesheet" href="/assets/index-safe.css?SECRET=TOKEN#SECRET">',
  );
  const result = await f.run();
  const serialized = JSON.stringify(result);
  expect(result.complete).toBe(true);
  expect(result.counts).toEqual({
    Assign: 2,
    Priority: 1,
    dialog: 0,
    overlay: 0,
  });
  expect(serialized).not.toContain('SECRET');
  expect(serialized).not.toContain('secret.invalid');
  expect(
    result.patterns.filter((entry) => entry.kind === 'Assign'),
  ).toHaveLength(2);
  expect(result.root[1]?.computed['pointer-events']).toBe('none');
  expect(result.root[1]?.inline['pointer-events']).toBe('none');
  expect(result.links[0]?.assetPath).toBe('/assets/index-safe.css');
  expect(serialized).toContain('"aria-controls":true');
});

test('identical closed triggers aggregate; modal ancestor state and post-close restoration stay distinct', async () => {
  const f = fixture();
  const region = f.document.querySelector('[role=region]')!;
  region.setAttribute('aria-hidden', 'true');
  f.document.body.setAttribute('data-scroll-locked', '1');
  f.document.body.insertAdjacentHTML(
    'beforeend',
    '<div role="dialog" data-state="open"></div><div class="bg-bg-overlay" data-state="open"></div>',
  );
  const open = await f.run();
  expect(open.patterns.find((entry) => entry.kind === 'Assign')?.count).toBe(2);
  expect(open.counts.dialog).toBe(1);
  expect(open.counts.overlay).toBe(1);
  expect(JSON.stringify(open.representatives)).toContain(
    '"aria-hidden":"true"',
  );
  region.removeAttribute('aria-hidden');
  f.document.body.removeAttribute('data-scroll-locked');
  f.document.querySelector('[role=dialog]')!.remove();
  f.document.querySelector('.bg-bg-overlay')!.remove();
  const closed = await f.run();
  expect(closed.counts.dialog).toBe(0);
  expect(JSON.stringify(closed.representatives)).not.toContain(
    '"aria-hidden":"true"',
  );
});

test('injected stylesheet bytes are hashed without retaining their content', async () => {
  const f = fixture();
  const css =
    '.secret { background-image: url(https://secret.invalid/token); }';
  const style = f.document.createElement('style');
  style.textContent = css;
  f.document.head.append(style);
  const result = await f.run();
  expect(result.styles).toEqual([
    {
      bytes: Buffer.byteLength(css),
      sha256: createHash('sha256').update(css).digest('hex'),
    },
  ]);
  expect(JSON.stringify(result)).not.toContain('secret.invalid');
});

test('node, signature and attribute overflow remain explicitly incomplete instead of truncated success', async () => {
  for (const limits of [
    { nodes: 2, patterns: 2000 },
    { nodes: 100000, patterns: 1 },
  ]) {
    const result = await fixture().run(limits);
    expect(result.complete).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  }
  const f = fixture();
  f.document
    .querySelector('button')!
    .setAttribute('data-state', 'x'.repeat(81));
  expect((await f.run()).complete).toBe(false);
  await expect(f.run({ nodes: 100001, patterns: 2000 })).rejects.toThrow(
    'Invalid',
  );
});

test('elapsed inventory deadline produces incomplete evidence even if node budget remains', async () => {
  const f = fixture();
  let clock = 0;
  Object.defineProperty(f.dom.window.performance, 'now', {
    value: () => (clock += 2000),
  });
  const result = await f.run();
  expect(result.complete).toBe(false);
  expect(result.errors).toContain('Style inventory exceeded5s');
});

import { afterEach, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { MessageChannel } from 'node:worker_threads';

import { JSDOM } from 'jsdom';

const observer = await readFile(
  new URL('./browser/observer.js', import.meta.url),
  'utf8',
);
const owned: JSDOM[] = [];
afterEach(() => {
  for (const dom of owned.splice(0)) dom.window.close();
});

function fixture() {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'http://127.0.0.1',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  owned.push(dom);
  Object.assign(dom.window, {
    MessageChannel,
    PerformanceObserver: class {
      observe() {}
    },
  });
  dom.window.eval(observer);
  const perf = (
    dom.window as unknown as {
      __perf: {
        watchDialog: (title: string, open: boolean) => Promise<unknown>;
      };
    }
  ).__perf;
  return { document: dom.window.document, perf };
}

async function mutations() {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

test('body text and a nested dialog title cannot certify a different task dialog', async () => {
  const f = fixture();
  let ready = false;
  const pending = f.perf.watchDialog('Target task', true).then(() => {
    ready = true;
    return true;
  });
  f.document.body.innerHTML =
    '<div role="dialog" aria-labelledby="outer-title"><h2 id="outer-title">Other task</h2><p>Target task</p></div>';
  await mutations();
  expect(ready).toBe(false);
  // A title belonging to a nested dialog must not name its outer ancestor.
  f.document.body.innerHTML =
    '<div role="dialog" aria-labelledby="nested-title"><div role="dialog" aria-label="Other task"><h2 id="nested-title">Target task</h2></div></div>';
  await mutations();
  expect(ready).toBe(false);
  f.document.body.innerHTML =
    '<div role="dialog" aria-labelledby="target-title"><h2 id="target-title">Target task</h2><div aria-busy="true"></div></div>';
  await mutations();
  expect(ready).toBe(false);
  f.document.querySelector('[aria-busy]')!.removeAttribute('aria-busy');
  await pending;
  expect(ready).toBe(true);
});

test('close waits for the original dialog to unmount even when its title changes first', async () => {
  const f = fixture();
  f.document.body.innerHTML =
    '<div role="dialog" aria-label="Target task"></div>';
  const dialog = f.document.querySelector('[role="dialog"]')!;
  let ready = false;
  const pending = f.perf.watchDialog('Target task', false).then(() => {
    ready = true;
    return true;
  });
  dialog.setAttribute('aria-label', 'Closing');
  await mutations();
  expect(ready).toBe(false);
  dialog.remove();
  await pending;
  expect(ready).toBe(true);
});

test('ambiguous task titles and an absent close target fail instead of producing timings', async () => {
  const f = fixture();
  await expect(f.perf.watchDialog('Target task', false)).rejects.toThrow(
    'exactly one',
  );
  f.document.body.innerHTML =
    '<div role="dialog" aria-label="Target task"></div><div role="dialog" aria-label="Target task"></div>';
  await expect(f.perf.watchDialog('Target task', true)).rejects.toThrow(
    'ambiguous',
  );
});

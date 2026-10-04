import { afterEach, expect, test } from 'bun:test';
import { MessageChannel } from 'node:worker_threads';

import { JSDOM } from 'jsdom';

import { acceptanceInitScript } from './browser/acceptance-init.ts';

const owned: JSDOM[] = [];
afterEach(() => {
  for (const dom of owned.splice(0)) dom.window.close();
});
test('document-start installation arms immediately and treats fixture names as data', () => {
  const dom = new JSDOM('<!doctype html>', {
    url: 'https://127.0.0.2:43830/tasks',
    runScripts: 'outside-only',
  });
  owned.push(dom);
  Object.assign(dom.window, {
    MessageChannel,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  });
  const title = '"});window.fixtureExecuted=true;//';
  dom.window.eval(
    acceptanceInitScript(
      {
        path: '/tasks',
        searchValue: '',
        tasks: [{ title, assigneeName: null }],
      },
      { path: '/overview', projectName: title },
      'board',
    ),
  );
  const values = dom.window as unknown as {
    __acceptance: object;
    __benchmarkReady: Promise<unknown>;
    fixtureExecuted?: boolean;
  };
  expect(values.__acceptance).toBeDefined();
  expect(typeof values.__benchmarkReady.then).toBe('function');
  expect(values.fixtureExecuted).toBeUndefined();
  // Cancel its owned observer through the real lifecycle, not by running a
  // false timing sample. Installation never needed DOMContentLoaded.
  const result = values.__benchmarkReady.catch((error: Error) => error.message);
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  return expect(result).resolves.toBe('Acceptance document was replaced');
});

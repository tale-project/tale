import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { measurementPlan } from './browser/mode.mjs';

/** Profiling changes timings and must never leak back into acceptance through
 * reuse of diagnostic capture. This guard supplements the executed pure plan
 * and oracle tests; hosted evidence still owns actual browser behavior. */
test('the acceptance timed entrypoint remains separate from profiled capture and high-volume controls', async () => {
  const entry = measurementPlan('acceptance').script;
  expect(entry).toBe('acceptance.ts');
  for (const name of [
    entry,
    'browser-session.ts',
    'browser-identity.ts',
    'acceptance-init.ts',
    'acceptance-oracle.js',
  ]) {
    const source = await readFile(
      new URL(`./browser/${name}`, import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(
      /(?:Profiler|Tracing)\.(?:enable|start|stop|end)/,
    );
    expect(source).not.toMatch(
      /from ['"]\.\/(?:phase|trace|trace-controls|capture|protocol)\./,
    );
    expect(source).not.toContain('recordVideo');
    const timedSource =
      name === entry
        ? source.split('// All timing rows are immutable')[0]!
        : source;
    expect(timedSource).not.toContain('.screenshot(');
  }
});

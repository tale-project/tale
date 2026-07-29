import { describe, expect, test } from 'bun:test';

import { buildInstrumentBundle, readBuildOutput } from './bundle';

describe('readBuildOutput', () => {
  test('throws (after logging each message) when the build failed', async () => {
    await expect(
      readBuildOutput({
        success: false,
        logs: [{ message: 'syntax error' }],
        outputs: [],
      }),
    ).rejects.toThrow('failed to build the instrument bundle');
  });

  test('throws when a successful build produced no output', async () => {
    await expect(
      readBuildOutput({ success: true, logs: [], outputs: [] }),
    ).rejects.toThrow('produced no output');
  });

  test('returns the first artifact’s text on success', async () => {
    const text = await readBuildOutput({
      success: true,
      logs: [],
      outputs: [{ text: async () => '(() => {})()' }],
    });
    expect(text).toBe('(() => {})()');
  });
});

describe('buildInstrumentBundle', () => {
  test('Bun builds a self-contained instrument IIFE in memory', async () => {
    const bundle = await buildInstrumentBundle();
    // A classic IIFE the browser runs as an init script — bundled, no imports.
    expect(bundle.startsWith('(()')).toBe(true);
    expect(bundle).toContain('installVisualAspectInstrument');
    expect(bundle).toContain('__VA');
    expect(bundle).not.toContain('import {');
  });

  test('the result is cached (same string on a second call)', async () => {
    const a = await buildInstrumentBundle();
    const b = await buildInstrumentBundle();
    expect(a).toBe(b);
  });
});

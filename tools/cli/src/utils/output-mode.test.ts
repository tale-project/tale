import { describe, expect, test } from 'bun:test';

import { resolveOutputMode } from './output-mode';

// Pin the platform so the capability probe is deterministic across CI runners —
// on win32 without a modern terminal it falls to PLAIN (color/interactive off),
// which would otherwise flip these TTY expectations on the Windows build.
const TTY = { isTTY: true, platform: 'linux' };
const NOTTY = { isTTY: false, platform: 'linux' };

describe('resolveOutputMode', () => {
  test('default on a TTY: full color + interactive, no flags set', () => {
    const m = resolveOutputMode({}, {}, TTY);
    expect(m).toMatchObject({
      json: false,
      quiet: false,
      verbose: false,
      assumeYes: false,
      ci: false,
    });
    expect(m.capabilities.color).toBe(true);
    expect(m.capabilities.interactive).toBe(true);
  });

  test('--no-color disables color but stays interactive', () => {
    const m = resolveOutputMode({ color: false }, {}, TTY);
    expect(m.capabilities.color).toBe(false);
    expect(m.capabilities.interactive).toBe(true);
  });

  test('FORCE_COLOR in env enables color even on a non-TTY', () => {
    const m = resolveOutputMode({}, { FORCE_COLOR: '1' }, NOTTY);
    expect(m.capabilities.color).toBe(true);
    expect(m.capabilities.interactive).toBe(false);
  });

  test('--no-color beats FORCE_COLOR (NO_COLOR precedence)', () => {
    const m = resolveOutputMode({ color: false }, { FORCE_COLOR: '1' }, TTY);
    expect(m.capabilities.color).toBe(false);
  });

  test('--verbose: raw passthrough (non-interactive), color preserved', () => {
    const m = resolveOutputMode({ verbose: true }, {}, TTY);
    expect(m.verbose).toBe(true);
    expect(m.capabilities.interactive).toBe(false);
    expect(m.capabilities.color).toBe(true);
  });

  test('--quiet sets the flag without changing capabilities', () => {
    const m = resolveOutputMode({ quiet: true }, {}, TTY);
    expect(m.quiet).toBe(true);
    expect(m.capabilities.interactive).toBe(true);
  });

  test('--json forces non-interactive and marks ci', () => {
    const m = resolveOutputMode({ json: true }, {}, TTY);
    expect(m.json).toBe(true);
    expect(m.ci).toBe(true);
    expect(m.capabilities.interactive).toBe(false);
  });

  test('--ci forces non-interactive', () => {
    const m = resolveOutputMode({ ci: true }, {}, TTY);
    expect(m.ci).toBe(true);
    expect(m.capabilities.interactive).toBe(false);
  });

  test('--yes sets assumeYes', () => {
    expect(resolveOutputMode({ yes: true }, {}, TTY).assumeYes).toBe(true);
  });

  test('--json --no-color compose: no color, non-interactive, json', () => {
    const m = resolveOutputMode({ json: true, color: false }, {}, TTY);
    expect(m.json).toBe(true);
    expect(m.capabilities.color).toBe(false);
    expect(m.capabilities.interactive).toBe(false);
  });
});

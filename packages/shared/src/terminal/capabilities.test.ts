import { describe, expect, it } from 'vitest';

import { type CapabilityEnv, detectCapabilities } from './capabilities.ts';

function caps(input: CapabilityEnv) {
  return detectCapabilities(input);
}

describe('detectCapabilities', () => {
  it('a plain interactive TTY gets color + interactive + unicode', () => {
    const c = caps({ isTTY: true, platform: 'linux', env: {} });
    expect(c).toMatchObject({ color: true, interactive: true, unicode: true });
  });

  it('NO_COLOR (presence, even empty) strips color but keeps the live region', () => {
    const c = caps({ isTTY: true, platform: 'linux', env: { NO_COLOR: '' } });
    expect(c.color).toBe(false);
    expect(c.interactive).toBe(true);
  });

  it('FORCE_COLOR enables color on a non-TTY but NEVER interactive', () => {
    const c = caps({
      isTTY: false,
      platform: 'linux',
      env: { FORCE_COLOR: '1' },
    });
    expect(c.color).toBe(true);
    expect(c.interactive).toBe(false);
  });

  it('CI forces plain (no live region) even with a TTY', () => {
    const c = caps({ isTTY: true, platform: 'linux', env: { CI: 'true' } });
    expect(c.interactive).toBe(false);
    expect(c.isCI).toBe(true);
  });

  it('GITHUB_ACTIONS presence counts as CI', () => {
    const c = caps({
      isTTY: true,
      platform: 'linux',
      env: { GITHUB_ACTIONS: 'true' },
    });
    expect(c.isCI).toBe(true);
    expect(c.interactive).toBe(false);
  });

  it('TERM=dumb disables color, interactive AND unicode', () => {
    const c = caps({ isTTY: true, platform: 'linux', env: { TERM: 'dumb' } });
    expect(c).toMatchObject({
      color: false,
      interactive: false,
      unicode: false,
    });
  });

  it('Windows legacy console (no modern marker) falls all the way to plain', () => {
    const c = caps({ isTTY: true, platform: 'win32', env: {} });
    expect(c).toMatchObject({
      color: false,
      interactive: false,
      unicode: false,
    });
  });

  it('Windows Terminal (WT_SESSION) is fully capable', () => {
    const c = caps({
      isTTY: true,
      platform: 'win32',
      env: { WT_SESSION: 'x' },
    });
    expect(c).toMatchObject({ color: true, interactive: true, unicode: true });
  });

  it('TALE_VERBOSE forces plain mode (raw passthrough) but keeps color', () => {
    const c = caps({
      isTTY: true,
      platform: 'linux',
      env: { TALE_VERBOSE: '1' },
    });
    expect(c.interactive).toBe(false);
    expect(c.color).toBe(true);
  });

  it('a non-UTF-8 locale downgrades unicode only', () => {
    const c = caps({ isTTY: true, platform: 'linux', env: { LANG: 'C' } });
    expect(c.unicode).toBe(false);
    expect(c.color).toBe(true);
    expect(c.interactive).toBe(true);
  });

  it('columns falls back to 80 when unknown', () => {
    expect(caps({ isTTY: true, env: {} }).columns).toBe(80);
    expect(caps({ isTTY: true, columns: 120, env: {} }).columns).toBe(120);
  });

  it('a piped (non-TTY) stdout is plain and colorless by default', () => {
    const c = caps({ isTTY: false, platform: 'linux', env: {} });
    expect(c).toMatchObject({ color: false, interactive: false });
  });
});

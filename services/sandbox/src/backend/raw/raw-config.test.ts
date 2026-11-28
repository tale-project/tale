import { describe, expect, it } from 'bun:test';

import { parseRawConfig, RawConfigError } from './raw-config.ts';

const slot = {
  user: 'tale-slot-01',
  uid: 61001,
  gid: 61001,
  home: '/var/lib/tale-sandbox/slots/tale-slot-01',
};
const base = {
  root: '/var/lib/tale-sandbox',
  isolation: 'isolated',
  slots: [slot],
  runnerd: [
    '/usr/local/lib/tale-sandbox/tale',
    '/var/lib/tale-sandbox/lib/x/runnerd.mjs',
  ],
  runnerdEnv: { BUN_BE_BUN: '1' },
  bin: '/var/lib/tale-sandbox/lib/x/bin',
  path: ['/opt/tale-agents/bin'],
  claudeSettings: '/var/lib/tale-sandbox/lib/x/claude-settings.json',
};

describe('parseRawConfig', () => {
  it('reads an isolated and a shared device', () => {
    expect(parseRawConfig(JSON.stringify(base))).toEqual({
      ...base,
      isolation: 'isolated',
    });
    const shared = parseRawConfig(
      JSON.stringify({
        ...base,
        isolation: 'shared',
        slots: [],
        claudeSettings: null,
      }),
    );
    expect(shared.slots).toEqual([]);
    expect(shared.claudeSettings).toBeNull();
  });

  it.each([
    ['no value', undefined],
    ['not JSON', '{'],
    ['an unknown isolation', JSON.stringify({ ...base, isolation: 'open' })],
    [
      'an isolated device without slots',
      JSON.stringify({ ...base, slots: [] }),
    ],
    [
      'a shared device with slots',
      JSON.stringify({ ...base, isolation: 'shared' }),
    ],
    [
      'a slot as root',
      JSON.stringify({ ...base, slots: [{ ...slot, uid: 0 }] }),
    ],
    [
      'two slots of one uid',
      JSON.stringify({
        ...base,
        slots: [slot, { ...slot, user: 'tale-slot-02' }],
      }),
    ],
    [
      'a root with a space',
      JSON.stringify({ ...base, root: '/var/lib/tale sandbox' }),
    ],
    ['a relative root', JSON.stringify({ ...base, root: 'tale-sandbox' })],
    [
      'a root with a trailing slash',
      JSON.stringify({ ...base, root: '/var/lib/tale-sandbox/' }),
    ],
    ['no runnerd', JSON.stringify({ ...base, runnerd: [] })],
    ['a relative runnerd', JSON.stringify({ ...base, runnerd: ['tale'] })],
    [
      'a PATH entry holding a colon',
      JSON.stringify({ ...base, path: ['/a:/b'] }),
    ],
    [
      'a bad runnerd variable',
      JSON.stringify({ ...base, runnerdEnv: { 'A-B': '1' } }),
    ],
  ])('refuses %s', (_what, raw) => {
    expect(() => parseRawConfig(raw)).toThrow(RawConfigError);
  });
});

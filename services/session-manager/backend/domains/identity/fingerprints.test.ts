// No browser needed: `launchOptions` of camoufox-js is replaced by a stand-in
// that resolves a config the way the real one does (fills in what is missing
// with random values, lets the caller's config win). The real thing is in
// `fingerprints.camoufox.test.ts`.

import { createHash } from 'node:crypto';

import type { Fingerprint } from 'fingerprint-generator';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { OS_CHOICES as API_OS_CHOICES } from '../../../lib/api/schemas.ts';
import {
  FALLBACK_SCREEN,
  MAX_UNIQUE_TRIES,
  OS_CHOICES,
  OS_WEIGHTS,
  createIdentity,
  drawIdentity,
  largestScreen,
  pickOs,
  resolvedConfig,
  signatures,
  summarize,
} from './fingerprints.ts';
import type { IdentityDeps, LaunchArgs } from './fingerprints.ts';
import { identityLaunchOptions } from './launch-options.ts';
import {
  IDENTITY_SCHEMA,
  IdentityError,
  identityFromJson,
  identityToJson,
} from './types.ts';
import type { Identity, IdentityOs } from './types.ts';

// The module is imported when it is first used, as the app sets the install
// directory of camoufox-js first.
const camoufox = vi.hoisted(() => ({ loads: 0, launchOptions: vi.fn() }));
vi.mock('camoufox-js', () => {
  camoufox.loads += 1;
  return { launchOptions: camoufox.launchOptions };
});

const BOUND: [number, number] = [1728, 1117];
const OSES: readonly IdentityOs[] = ['windows', 'macos', 'linux'];
const WEBGL_PAIRS: readonly [string, string][] = [
  [
    'Google Inc. (NVIDIA)',
    'ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar',
  ],
  [
    'Google Inc. (Intel)',
    'ANGLE (Intel, Intel(R) HD Graphics 400 Direct3D11 vs_5_0 ps_5_0), or similar',
  ],
  ['Apple', 'Apple M1, or similar'],
  ['Intel', 'Intel(R) HD Graphics, or similar'],
];
const SEEDS = ['fonts:spacing_seed', 'audio:seed', 'canvas:seed'];

/** A repeatable stand-in for `Math.random` (mulberry32). */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FakeBuild {
  /** The seeds the installed build knows (older builds have no audio and canvas seeds). */
  seeds?: readonly string[];
  /** Random values of the build that nothing pins (a future camoufox-js). */
  unpinned?: readonly string[];
  /** The WebGL pairs of the sample database. */
  webgl?: readonly (readonly [string, string])[];
  noWebgl?: boolean;
  /** Where CAMOU_CONFIG is cut into CAMOU_CONFIG_<n>. */
  chunkSize?: number;
  /** Puts the chunks into the environment last to first. */
  reversed?: boolean;
  seed?: number;
}

/** What camoufox-js does with a screen: a window off-screen gets a random vertical position. */
function screenYOf(
  screen: Fingerprint['screen'],
  randint: (min: number, max: number) => number,
): number {
  const x = screen.screenX;
  if (!x) return 0;
  if (x >= -50 && x <= 50) return x;
  const free = screen.availHeight - screen.outerHeight;
  if (free === 0) return 0;
  return free > 0 ? randint(0, free) : randint(free, 0);
}

function fakeCamoufox(build: FakeBuild = {}) {
  const random = seeded(build.seed ?? 1);
  const randint = (min: number, max: number) =>
    Math.floor(random() * (max - min + 1)) + min;
  const calls: LaunchArgs[] = [];

  const launchOptions: NonNullable<IdentityDeps['launchOptions']> = (
    options,
  ) => {
    calls.push(structuredClone(options));
    const { fingerprint } = options;
    if (!fingerprint)
      throw new Error('the stand-in resolves a given fingerprint');
    // As the real one, it changes the config it is given and only fills in what is missing.
    const config: Record<string, unknown> = options.config ?? {};
    const setIfMissing = (key: string, value: () => unknown) => {
      if (!(key in config)) config[key] = value();
    };
    const { navigator, screen } = fingerprint;
    setIfMissing('navigator.userAgent', () => navigator.userAgent);
    setIfMissing('navigator.platform', () => navigator.platform);
    setIfMissing(
      'navigator.hardwareConcurrency',
      () => navigator.hardwareConcurrency,
    );
    setIfMissing('screen.width', () => screen.width);
    setIfMissing('screen.height', () => screen.height);
    setIfMissing('window.outerWidth', () => screen.outerWidth);
    setIfMissing('window.outerHeight', () => screen.outerHeight);
    setIfMissing('window.screenX', () => screen.screenX);
    setIfMissing('window.screenY', () => screenYOf(screen, randint));
    for (const seed of build.seeds ?? SEEDS) {
      setIfMissing(seed, () => randint(1, 4_294_967_295));
    }
    for (const key of build.unpinned ?? []) {
      setIfMissing(key, () => randint(1, 1000));
    }
    setIfMissing('window.history.length', () => randint(1, 5));
    if (!build.noWebgl) {
      const pairs = build.webgl ?? WEBGL_PAIRS;
      const [vendor, renderer] =
        options.webgl_config ?? pairs[randint(0, pairs.length - 1)];
      setIfMissing('webGl:vendor', () => vendor);
      setIfMissing('webGl:renderer', () => renderer);
      setIfMissing('webGl:parameters', () => ({
        7936: vendor,
        7937: renderer,
      }));
    }
    setIfMissing('canvas:aaOffset', () => randint(-50, 50));
    setIfMissing('canvas:aaCapOffset', () => true);
    if (typeof options.locale === 'string') {
      const [language, region] = options.locale.split('-');
      config['locale:language'] = language;
      config['locale:region'] = region;
    }

    const text = JSON.stringify(config);
    const size = build.chunkSize ?? 2047;
    const chunks: [string, string][] = [];
    for (let start = 0; start < text.length; start += size) {
      chunks.push([
        `CAMOU_CONFIG_${start / size + 1}`,
        text.slice(start, start + size),
      ]);
    }
    if (build.reversed) chunks.reverse();
    return Promise.resolve({
      executablePath: '/fake/camoufox',
      env: { ...Object.fromEntries(chunks), ...options.env },
      headless: false,
    });
  };
  return { launchOptions, calls };
}

// A few real fingerprints per OS, as `drawIdentity` draws them: it refuses some
// that the generator gives (see "a fingerprint without the CPU of its OS"), and
// a test that pins one of the pool needs one that it takes. The generator takes
// 40 ms for one.
const pool: Record<IdentityOs, Fingerprint[]> = {
  windows: [],
  macos: [],
  linux: [],
};
beforeAll(async () => {
  for (const os of OSES) {
    for (let n = 0; n < 6; n++) {
      const { fingerprint } = await drawIdentity(os, BOUND, {
        launchOptions: fakeCamoufox().launchOptions,
      });
      // Two real fingerprints can look alike to the stand-in: these never do.
      fingerprint.navigator.hardwareConcurrency = 2 + n;
      pool[os].push(fingerprint);
    }
  }
});

/** The generator of `drawIdentity`, handing out the pool of real fingerprints in turn. */
function fromPool(): NonNullable<IdentityDeps['generate']> {
  const next: Record<IdentityOs, number> = { windows: 0, macos: 0, linux: 0 };
  return (os) => structuredClone(pool[os][next[os]++ % pool[os].length]);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  camoufox.launchOptions.mockReset();
});

describe('pickOs', () => {
  it('passes the name of an OS through', () => {
    for (const os of OSES) expect(pickOs(os)).toBe(os);
  });

  it('draws an OS by weight for "random"', () => {
    const picked = new Set(Array.from({ length: 200 }, () => pickOs('random')));
    expect(picked).toEqual(new Set(OSES));
  });

  it('divides the range of the draw as 60 % Windows, 20 % macOS, 20 % Linux', () => {
    const at = (draw: number) => pickOs('random', () => draw);
    expect(at(0)).toBe('windows');
    expect(at(0.59)).toBe('windows');
    expect(at(0.61)).toBe('macos');
    expect(at(0.79)).toBe('macos');
    expect(at(0.81)).toBe('linux');
    expect(at(0.999999)).toBe('linux');
    expect(at(1)).toBe('linux');
  });

  it('follows the weights over many draws', () => {
    const random = seeded(42);
    const counts = { windows: 0, macos: 0, linux: 0 };
    for (let n = 0; n < 10_000; n++) counts[pickOs('random', random)] += 1;
    expect(counts.windows / 10_000).toBeCloseTo(0.6, 1);
    expect(counts.macos / 10_000).toBeCloseTo(0.2, 1);
    expect(counts.linux / 10_000).toBeCloseTo(0.2, 1);
    expect(counts.macos).toBeGreaterThan(1500);
    expect(counts.linux).toBeGreaterThan(1500);
  });

  it.each(['android', 'Windows', 'ios', ''])('refuses %j', (name) => {
    expect(() => pickOs(name)).toThrow(RangeError);
    expect(() => pickOs(name)).toThrow(
      'os must be one of random, windows, macos, linux',
    );
  });

  it('has the weights and choices of the API', () => {
    expect(OS_WEIGHTS).toEqual({ windows: 0.6, macos: 0.2, linux: 0.2 });
    expect(OS_CHOICES).toEqual(['random', 'windows', 'macos', 'linux']);
    expect(OS_CHOICES).toEqual(API_OS_CHOICES);
    expect(
      Object.values(OS_WEIGHTS).reduce((sum, weight) => sum + weight, 0),
    ).toBeCloseTo(1);
  });
});

describe('largestScreen', () => {
  it('is 1920x1080 unless told otherwise', () => {
    expect(largestScreen({})).toEqual([1920, 1080]);
    expect(largestScreen({ SESSION_MANAGER_MAX_SCREEN: '' })).toEqual([
      1920, 1080,
    ]);
    expect(largestScreen({ SESSION_MANAGER_MAX_SCREEN: '  ' })).toEqual([
      1920, 1080,
    ]);
    expect(FALLBACK_SCREEN).toEqual([1920, 1080]);
  });

  it('hands out a copy of the fallback', () => {
    const screen = largestScreen({});
    screen[0] = 1;
    expect(largestScreen({})).toEqual([1920, 1080]);
  });

  it.each([
    ['1728x1117', [1728, 1117]],
    ['2560X1440', [2560, 1440]],
    [' 1440 x 900 ', [1440, 900]],
    ['1920×1080', [1920, 1080]],
    ['800x600', [800, 600]],
  ])('reads %j from SESSION_MANAGER_MAX_SCREEN', (value, expected) => {
    expect(largestScreen({ SESSION_MANAGER_MAX_SCREEN: value })).toEqual(
      expected,
    );
  });

  it('reads the environment of the process by default', () => {
    vi.stubEnv('SESSION_MANAGER_MAX_SCREEN', '1280x720');
    expect(largestScreen()).toEqual([1280, 720]);
  });

  it.each(['wide', '1920', '1920x', 'x1080', '0x0', '0x1080', '-1x5', '1e3x5'])(
    'warns and falls back for %j',
    (value) => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      expect(largestScreen({ SESSION_MANAGER_MAX_SCREEN: value })).toEqual([
        1920, 1080,
      ]);
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        `ignoring SESSION_MANAGER_MAX_SCREEN=${JSON.stringify(value)}: expected WIDTHxHEIGHT, for example 1920x1080`,
      );
    },
  );
});

describe('signatures', () => {
  const config = {
    'navigator.userAgent': 'UA',
    'screen.width': 1920,
    'audio:seed': 1,
    'mediaDevices:micros': 1,
  };

  it('ignore geo values and add-ons, and the visible one ignores the noise', () => {
    const [visible, full] = signatures(config);
    const geo = {
      timezone: 'Europe/Zurich',
      'locale:language': 'de',
      'geolocation:latitude': 47.0,
      'webrtc:ipv4': '1.1.1.1',
    };
    expect(signatures({ ...config, ...geo, addons: ['/some/path'] })).toEqual([
      visible,
      full,
    ]);
    const [noisyVisible, noisyFull] = signatures({
      ...config,
      'audio:seed': 2,
    });
    expect(noisyVisible).toBe(visible);
    expect(noisyFull).not.toBe(full);
    expect(signatures({ ...config, 'screen.width': 1280 })[0]).not.toBe(
      visible,
    );
  });

  it.each([
    'audio:seed',
    'canvas:seed',
    'fonts:spacing_seed',
    'window.history.length',
    'window.screenY',
    'canvas:aaOffset',
    'canvas:aaCapOffset',
    'mediaDevices:micros',
    'mediaDevices:webcams',
    'mediaDevices:speakers',
  ])('treat %s as noise: it is not visible, but it is a difference', (key) => {
    const base = { 'screen.width': 1920, [key]: 1 };
    const [visible, full] = signatures(base);
    const [otherVisible, otherFull] = signatures({ ...base, [key]: 2 });
    expect(otherVisible).toBe(visible);
    expect(otherFull).not.toBe(full);
  });

  it.each([
    'navigator.userAgent',
    'navigator.platform',
    'screen.width',
    'window.screenX',
    'window.outerWidth',
    'webGl:renderer',
    'webGl:vendor',
    'webGl:parameters',
    'fonts',
  ])('treat %s as visible', (key) => {
    const base = { 'audio:seed': 1, [key]: 'a' };
    const changed = signatures({ ...base, [key]: 'b' });
    const [visible, full] = signatures(base);
    expect(changed[0]).not.toBe(visible);
    expect(changed[1]).not.toBe(full);
  });

  it.each([
    'timezone',
    'locale:language',
    'locale:region',
    'locale:all',
    'geolocation:latitude',
    'geolocation:longitude',
    'webrtc:ipv4',
    'webrtc:ipv6',
    'addons',
  ])('leave out %s, which follows the proxy or is local', (key) => {
    const base = { 'screen.width': 1920 };
    expect(signatures({ ...base, [key]: 'x' })).toEqual(signatures(base));
  });

  it('are the SHA-256 of the config as JSON with sorted keys, nested ones too', () => {
    const sha = (text: string) =>
      createHash('sha256').update(text).digest('hex');
    const [visible, full] = signatures({
      b: 1,
      'audio:seed': 7,
      a: { d: 2, c: [3, { f: 4, e: 5 }] },
    });
    expect(visible).toBe(sha('{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}'));
    expect(full).toBe(
      sha('{"a":{"c":[3,{"e":5,"f":4}],"d":2},"audio:seed":7,"b":1}'),
    );
    expect(visible).toMatch(/^[0-9a-f]{64}$/);
  });

  it('do not depend on the order of the keys, but on the order of a list', () => {
    const one = signatures({ x: 1, y: { p: 1, q: 2 }, fonts: ['a', 'b'] });
    const same = signatures({ fonts: ['a', 'b'], y: { q: 2, p: 1 }, x: 1 });
    const reordered = signatures({
      x: 1,
      y: { p: 1, q: 2 },
      fonts: ['b', 'a'],
    });
    expect(same).toEqual(one);
    expect(reordered[0]).not.toBe(one[0]);
  });

  it('tell a missing value from a null one', () => {
    expect(signatures({ x: 1, y: null })[0]).not.toBe(signatures({ x: 1 })[0]);
  });

  it('read an undefined value as JSON does: left out of an object, null in a list', () => {
    expect(signatures({ x: 1, y: undefined })).toEqual(signatures({ x: 1 }));
    expect(signatures({ x: [1, undefined] })).toEqual(
      signatures({ x: [1, null] }),
    );
  });
});

describe('summarize', () => {
  it('describes the config for lists', () => {
    expect(
      summarize({
        'navigator.userAgent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'navigator.platform': 'Win32',
        'screen.width': 1536,
        'screen.height': 864,
        'webGl:renderer': 'ANGLE (Intel), or similar',
      }),
    ).toEqual({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      platform: 'Win32',
      screen: '1536x864',
      gpu: 'ANGLE (Intel), or similar',
    });
  });

  it('leaves out what the config does not say', () => {
    const empty = { userAgent: null, platform: null, screen: null, gpu: null };
    expect(summarize({})).toEqual(empty);
    expect(summarize({ 'screen.width': 1536 }).screen).toBeNull();
    expect(summarize({ 'screen.height': 864 }).screen).toBeNull();
    expect(
      summarize({ 'screen.width': 0, 'screen.height': 864 }).screen,
    ).toBeNull();
    expect(
      summarize({
        'navigator.userAgent': 1,
        'navigator.platform': null,
        'screen.width': '1536',
        'screen.height': '864',
        'webGl:renderer': {},
      }),
    ).toEqual(empty);
  });
});

describe('resolvedConfig', () => {
  async function drawn(os: IdentityOs = 'windows', build: FakeBuild = {}) {
    const fake = fakeCamoufox(build);
    const deps = { launchOptions: fake.launchOptions, generate: fromPool() };
    const identity = await drawIdentity(os, BOUND, deps);
    fake.calls.length = 0;
    return { fake, deps, identity };
  }

  it('hands the identity to Camoufox', async () => {
    const { fake, deps, identity } = await drawn('linux');
    const withLocale: Identity = { ...identity, locale: 'fr-FR' };
    await resolvedConfig(withLocale, deps);
    const [call] = fake.calls;
    expect(call.fingerprint).toEqual(identity.fingerprint);
    expect(call.os).toBe('linux');
    expect(call.locale).toBe('fr-FR');
    expect(call.i_know_what_im_doing).toBe(true);
    expect(call.screen).toEqual({ maxWidth: BOUND[0], maxHeight: BOUND[1] });
    expect(call.webgl_config).toEqual(identity.webgl);
    expect(call.config).toEqual(identity.pinned);
  });

  it('leaves the language to Camoufox for an identity without one', async () => {
    const { fake, deps, identity } = await drawn();
    await resolvedConfig(identity, deps);
    expect(fake.calls[0]).not.toHaveProperty('locale');
  });

  it('keeps the default add-on and the environment of the process out of it', async () => {
    const { fake, deps, identity } = await drawn();
    const config = await resolvedConfig(identity, deps);
    expect(fake.calls[0].exclude_addons).toEqual(['UBO']);
    expect(fake.calls[0].env).toEqual({});
    expect(config).not.toHaveProperty('addons');
  });

  it('resolves an identity to the same config every time', async () => {
    const { deps, identity } = await drawn();
    const first = await resolvedConfig(identity, deps);
    for (let n = 0; n < 20; n++) {
      expect(await resolvedConfig(identity, deps)).toEqual(first);
    }
  });

  it('resolves an identity as stored to the same config', async () => {
    const { deps, identity } = await drawn();
    const reloaded = identityFromJson(identityToJson(identity));
    expect(await resolvedConfig(reloaded, deps)).toEqual(
      await resolvedConfig(identity, deps),
    );
    expect(signatures(await resolvedConfig(reloaded, deps))).toEqual(
      signatures(await resolvedConfig(identity, deps)),
    );
  });

  it('shows a language in the config without changing the signatures', async () => {
    const { deps, identity } = await drawn();
    const swiss = { ...identity, locale: 'de-CH' };
    const config = await resolvedConfig(swiss, deps);
    expect(config).toMatchObject({
      'locale:language': 'de',
      'locale:region': 'CH',
    });
    expect(signatures(config)).toEqual(
      signatures(await resolvedConfig(identity, deps)),
    );
  });

  it('does not change the identity', async () => {
    const { deps, identity } = await drawn('macos');
    const before = structuredClone(identity);
    const frozen = deepFreeze(structuredClone(identity));
    await resolvedConfig(frozen, deps);
    expect(frozen).toEqual(before);
  });

  it('puts the chunks of CAMOU_CONFIG back in the order of their numbers', async () => {
    const { identity } = await drawn();
    const small = fakeCamoufox({ chunkSize: 25, reversed: true });
    const launched = await small.launchOptions(identityLaunchOptions(identity));
    const names = Object.keys(launched.env ?? {});
    // CAMOU_CONFIG_10 comes after _9, not after _1
    expect(names.length).toBeGreaterThan(10);
    expect(names[0]).not.toBe('CAMOU_CONFIG_1');
    expect(
      await resolvedConfig(identity, { launchOptions: small.launchOptions }),
    ).toEqual(
      await resolvedConfig(identity, {
        launchOptions: fakeCamoufox().launchOptions,
      }),
    );
  });

  it('only reads the chunks of CAMOU_CONFIG from the environment', async () => {
    const { identity } = await drawn();
    const launchOptions: NonNullable<IdentityDeps['launchOptions']> = () =>
      Promise.resolve({
        env: {
          PATH: '/usr/bin',
          CAMOU_CONFIG_2: ',"b":2}',
          CAMOU_CONFIG_1: '{"a":1',
          CAMOU_CONFIG_EXTRA: 'x',
          CAMOU_CONFIG_1_OLD: 'x',
          CAMOU_CONFIG_3: 7,
          FONTCONFIG_PATH: '/fonts',
        },
      });
    expect(await resolvedConfig(identity, { launchOptions })).toEqual({
      a: 1,
      b: 2,
    });
  });

  it.each([
    ['no environment', {}, 'camoufox-js returned no environment'],
    [
      'an array as environment',
      { env: [] },
      'camoufox-js returned no environment',
    ],
    [
      'an environment without CAMOU_CONFIG',
      { env: { PATH: '/usr/bin' } },
      'camoufox-js returned no CAMOU_CONFIG',
    ],
    [
      'a config that is no object',
      { env: { CAMOU_CONFIG_1: '[1, 2]' } },
      'CAMOU_CONFIG is not a JSON object',
    ],
    [
      'a config that is null',
      { env: { CAMOU_CONFIG_1: 'null' } },
      'CAMOU_CONFIG is not a JSON object',
    ],
  ])('refuses %s', async (_why, launched, message) => {
    const { identity } = await drawn();
    const launchOptions: NonNullable<IdentityDeps['launchOptions']> = () =>
      Promise.resolve(launched);
    await expect(resolvedConfig(identity, { launchOptions })).rejects.toThrow(
      message,
    );
  });

  it('refuses a config that is cut off', async () => {
    const { identity } = await drawn();
    const launchOptions: NonNullable<IdentityDeps['launchOptions']> = () =>
      Promise.resolve({ env: { CAMOU_CONFIG_1: '{"a":' } });
    await expect(
      resolvedConfig(identity, { launchOptions }),
    ).rejects.toBeInstanceOf(SyntaxError);
  });

  it('passes on what camoufox-js says, as when the browser is not installed', async () => {
    const { identity } = await drawn();
    const launchOptions: NonNullable<IdentityDeps['launchOptions']> = () =>
      Promise.reject(new Error('Camoufox is not installed at /nowhere'));
    await expect(resolvedConfig(identity, { launchOptions })).rejects.toThrow(
      'Camoufox is not installed at /nowhere',
    );
  });
});

describe('camoufox-js', () => {
  it('is only imported when a config is resolved', async () => {
    expect(camoufox.loads).toBe(0);
    const fake = fakeCamoufox();
    const deps = { launchOptions: fake.launchOptions, generate: fromPool() };
    const identity = await drawIdentity('windows', BOUND, deps);
    expect(camoufox.loads).toBe(0);

    camoufox.launchOptions.mockImplementation(fake.launchOptions);
    const config = await resolvedConfig(identity);
    expect(camoufox.loads).toBe(1);
    expect(camoufox.launchOptions).toHaveBeenCalledOnce();
    expect(config).toEqual(await resolvedConfig(identity, deps));
  });
});

describe('drawIdentity', () => {
  const deps = (build: FakeBuild = {}): IdentityDeps => ({
    launchOptions: fakeCamoufox(build).launchOptions,
    generate: fromPool(),
  });

  it('is an identity of the OS that stays within the screen bound', async () => {
    const screens = deps();
    for (const os of OSES) {
      const identity = await drawIdentity(os, BOUND, screens);
      expect(identity.os).toBe(os);
      expect(identity.schema).toBe(IDENTITY_SCHEMA);
      expect(identity.maxScreen).toEqual(BOUND);
      expect(identity.locale).toBeNull();
      expect(identity.fingerprint.screen.width).toBeLessThanOrEqual(BOUND[0]);
      expect(identity.fingerprint.screen.height).toBeLessThanOrEqual(BOUND[1]);
    }
  });

  it.each(OSES)(
    'draws a %s fingerprint of the generator that fits, five times',
    async (os) => {
      // fresh from the generator, not from the pool
      const fake = fakeCamoufox();
      for (let n = 0; n < 5; n++) {
        const identity = await drawIdentity(os, BOUND, {
          launchOptions: fake.launchOptions,
        });
        const { screen, navigator } = identity.fingerprint;
        expect(screen.width).toBeLessThanOrEqual(BOUND[0]);
        expect(screen.height).toBeLessThanOrEqual(BOUND[1]);
        expect(identity.os).toBe(os);
        expect(identity.maxScreen).toEqual(BOUND);
        expect(navigator.userAgent).toContain('Firefox/');
        expect(navigator.platform).toMatch(
          { windows: /^Win/u, macos: /^Mac/u, linux: /^Linux/u }[os],
        );
      }
    },
  );

  it('does not hold on to the bound it is given', async () => {
    const bound: [number, number] = [1728, 1117];
    const identity = await drawIdentity('windows', bound, deps());
    bound[0] = 1;
    expect(identity.maxScreen).toEqual([1728, 1117]);
  });

  it('round trips through JSON, as the database stores it', async () => {
    const identity = await drawIdentity('windows', BOUND, deps());
    const pinned = { ...identity, locale: 'de-CH' };
    expect(identityFromJson(identityToJson(pinned))).toEqual(pinned);
    expect(Object.keys(JSON.parse(identityToJson(pinned)))).toEqual([
      'schema',
      'os',
      'fingerprint',
      'pinned',
      'webgl',
      'maxScreen',
      'locale',
    ]);
    expect(Object.keys(identity.fingerprint)).toContain('navigator');
    expect(identityFromJson(identityToJson(identity))).toEqual(identity);
  });

  it('is refused by a release that does not know its schema', async () => {
    const identity = await drawIdentity('windows', BOUND, deps());
    expect(() =>
      identityFromJson(JSON.stringify({ ...identity, schema: 99 })),
    ).toThrow();
  });

  it('pins everything that Camoufox would draw on every launch', async () => {
    const identity = await drawIdentity('windows', BOUND, deps());
    expect(Object.keys(identity.pinned).sort()).toEqual(
      [
        'audio:seed',
        'canvas:aaOffset',
        'canvas:seed',
        'fonts:spacing_seed',
        'window.history.length',
        'window.screenY',
      ].sort(),
    );
    for (const value of Object.values(identity.pinned)) {
      expect(typeof value).toBe('number');
    }
    expect(WEBGL_PAIRS.map((pair) => pair.join('|'))).toContain(
      identity.webgl.join('|'),
    );
  });

  it('pins the values that Camoufox drew, which later launches show', async () => {
    const both = deps();
    const identity = await drawIdentity('macos', BOUND, both);
    const config = await resolvedConfig(identity, both);
    for (const [key, value] of Object.entries(identity.pinned)) {
      expect(config[key], key).toBe(value);
    }
    expect([config['webGl:vendor'], config['webGl:renderer']]).toEqual(
      identity.webgl,
    );
  });

  it('lets Camoufox choose the WebGL pair once, and pins it for the other resolutions', async () => {
    const fake = fakeCamoufox();
    const identity = await drawIdentity('windows', BOUND, {
      launchOptions: fake.launchOptions,
      generate: fromPool(),
    });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0].webgl_config).toBeUndefined();
    expect(fake.calls[0].config).toEqual({});
    expect(fake.calls[1].webgl_config).toEqual(identity.webgl);
    expect(fake.calls[1].config).toEqual(identity.pinned);
    expect(fake.calls[0].fingerprint).toEqual(identity.fingerprint);
  });

  it('draws a different identity every time', async () => {
    const both = deps();
    const a = await drawIdentity('windows', BOUND, both);
    const b = await drawIdentity('windows', BOUND, both);
    expect(a.pinned).not.toEqual(b.pinned);
    expect(a.fingerprint).not.toEqual(b.fingerprint);
  });

  it('only pins what the installed build knows', async () => {
    const identity = await drawIdentity(
      'windows',
      BOUND,
      deps({ seeds: ['fonts:spacing_seed'] }),
    );
    expect(Object.keys(identity.pinned).sort()).toEqual(
      [
        'canvas:aaOffset',
        'fonts:spacing_seed',
        'window.history.length',
        'window.screenY',
      ].sort(),
    );
  });

  describe('a window that sits off-screen', () => {
    // camoufox-js draws its vertical position anew on every launch
    const offscreen = (): Fingerprint => {
      const fingerprint = structuredClone(pool.windows[0]);
      fingerprint.screen = {
        ...fingerprint.screen,
        screenX: 2552,
        availHeight: 900,
        outerHeight: 916,
        width: 1600,
        height: 900,
      };
      return fingerprint;
    };

    it('would get another position on every launch if it were not pinned', async () => {
      const fake = fakeCamoufox();
      const bare = identityFromJson(
        identityToJson({
          schema: IDENTITY_SCHEMA,
          os: 'windows',
          fingerprint: offscreen(),
          pinned: {},
          webgl: WEBGL_PAIRS[0],
          maxScreen: BOUND,
          locale: null,
        }),
      );
      const positions = new Set<unknown>();
      for (let n = 0; n < 10; n++) {
        const config = await resolvedConfig(bare, {
          launchOptions: fake.launchOptions,
        });
        positions.add(config['window.screenY']);
      }
      expect(positions.size).toBeGreaterThan(1);
    });

    it('keeps its position', async () => {
      const both: IdentityDeps = {
        launchOptions: fakeCamoufox().launchOptions,
        generate: () => offscreen(),
      };
      const identity = await drawIdentity('windows', BOUND, both);
      expect(typeof identity.pinned['window.screenY']).toBe('number');
      const positions = new Set<unknown>();
      for (let n = 0; n < 10; n++) {
        positions.add((await resolvedConfig(identity, both))['window.screenY']);
      }
      expect(positions).toEqual(new Set([identity.pinned['window.screenY']]));
    });
  });

  describe('a fingerprint without the CPU of its OS', () => {
    // The generator's data has `navigator.oscpu: null` for about 4 % of its
    // Windows fingerprints. Camoufox leaves `navigator.oscpu` alone for such a
    // fingerprint, and the page reads the computer's own ("Intel Mac OS X 10.15")
    // under the user agent of another OS.
    const without = (oscpu: unknown): Fingerprint => {
      const fingerprint = structuredClone(pool.windows[0]);
      Object.assign(fingerprint.navigator, { oscpu });
      return fingerprint;
    };

    it.each([
      ['null', null],
      ['missing', undefined],
      ['empty', ''],
    ])('is drawn again when its oscpu is %s', async (_kind, oscpu) => {
      const generate = vi
        .fn<NonNullable<IdentityDeps['generate']>>()
        .mockImplementationOnce(() => without(oscpu))
        .mockImplementationOnce(() => without(oscpu))
        .mockImplementationOnce(() => structuredClone(pool.windows[1]));
      const identity = await drawIdentity('windows', BOUND, {
        launchOptions: fakeCamoufox().launchOptions,
        generate,
      });
      expect(generate).toHaveBeenCalledTimes(3);
      expect(identity.fingerprint).toEqual(pool.windows[1]);
      expect(typeof identity.fingerprint.navigator.oscpu).toBe('string');
    });

    it('gives up after 500 draws that have none', async () => {
      const generate = vi.fn(() => without(null));
      const failure = drawIdentity('windows', BOUND, {
        launchOptions: fakeCamoufox().launchOptions,
        generate,
      });
      await expect(failure).rejects.toThrow(IdentityError);
      expect(generate).toHaveBeenCalledTimes(500);
    });
  });

  describe('the screen bound', () => {
    const tooBig = (): Fingerprint => {
      const fingerprint = structuredClone(pool.windows[0]);
      fingerprint.screen = { ...fingerprint.screen, width: 4000, height: 2000 };
      return fingerprint;
    };

    it('is met even when the generator ignores it', async () => {
      // it drops a bound that it cannot meet
      const generate = vi
        .fn<NonNullable<IdentityDeps['generate']>>()
        .mockImplementationOnce(tooBig)
        .mockImplementationOnce(tooBig)
        .mockImplementationOnce(() => structuredClone(pool.windows[1]));
      const identity = await drawIdentity('windows', BOUND, {
        launchOptions: fakeCamoufox().launchOptions,
        generate,
      });
      expect(generate).toHaveBeenCalledTimes(3);
      expect(generate).toHaveBeenCalledWith('windows', BOUND);
      expect(identity.fingerprint).toEqual(pool.windows[1]);
    });

    it('is met in width and in height', async () => {
      const wide = structuredClone(pool.windows[0]);
      wide.screen = { ...wide.screen, width: BOUND[0] + 1, height: 100 };
      const tall = structuredClone(pool.windows[0]);
      tall.screen = { ...tall.screen, width: 100, height: BOUND[1] + 1 };
      const exact = structuredClone(pool.windows[0]);
      exact.screen = { ...exact.screen, width: BOUND[0], height: BOUND[1] };
      const queue = [wide, tall, exact];
      const identity = await drawIdentity('windows', BOUND, {
        launchOptions: fakeCamoufox().launchOptions,
        generate: () => queue.shift() ?? wide,
      });
      expect(identity.fingerprint.screen.width).toBe(BOUND[0]);
      expect(identity.fingerprint.screen.height).toBe(BOUND[1]);
      expect(queue).toEqual([]);
    });

    it('gives up after 500 draws that do not fit', async () => {
      const generate = vi.fn(tooBig);
      const failure = drawIdentity('windows', BOUND, {
        launchOptions: fakeCamoufox().launchOptions,
        generate,
      });
      await expect(failure).rejects.toThrow(IdentityError);
      await expect(failure).rejects.toThrow(
        'could not draw a windows fingerprint that fits a 1728x1117 screen',
      );
      expect(generate).toHaveBeenCalledTimes(500);
    });

    it('gives up quickly when the generator has nothing for the screen', async () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const cause = new Error(
        'Failed to generate a consistent fingerprint after 10 attempts',
      );
      const generate = vi.fn(() => {
        throw cause;
      });
      const failure = await drawIdentity('linux', [1280, 720], {
        launchOptions: fakeCamoufox().launchOptions,
        generate,
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(IdentityError);
      expect(failure).toHaveProperty(
        'message',
        'could not draw a linux fingerprint that fits a 1280x720 screen',
      );
      expect(failure).toHaveProperty('cause', cause);
      expect(generate).toHaveBeenCalledTimes(3);
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        'the fingerprint generator has no linux fingerprint for a 1280x720 screen: Failed to generate a consistent fingerprint after 10 attempts',
      );
    });

    it('gives up on a generator that fails with something that is no error', async () => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const failure = await drawIdentity('windows', BOUND, {
        launchOptions: fakeCamoufox().launchOptions,
        generate: () => {
          throw 'out of fingerprints';
        },
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(IdentityError);
      expect(failure).toHaveProperty('cause', new Error('out of fingerprints'));
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        'the fingerprint generator has no windows fingerprint for a 1728x1117 screen: out of fingerprints',
      );
    });

    it('draws again after a generator failure', async () => {
      const generate = vi
        .fn<NonNullable<IdentityDeps['generate']>>()
        .mockImplementationOnce(() => {
          throw new Error('Failed to generate a consistent fingerprint');
        })
        .mockImplementation(() => structuredClone(pool.windows[2]));
      const identity = await drawIdentity('windows', BOUND, {
        launchOptions: fakeCamoufox().launchOptions,
        generate,
      });
      expect(generate).toHaveBeenCalledTimes(2);
      expect(identity.fingerprint).toEqual(pool.windows[2]);
    });
  });

  describe('a resolution that is not stable', () => {
    it('is refused, naming the keys that differ', async () => {
      const failure = drawIdentity(
        'windows',
        BOUND,
        deps({ unpinned: ['webgl:seed', 'newer:seed'] }),
      );
      await expect(failure).rejects.toThrow(
        'a windows identity does not resolve to the same Camoufox config twice (differs at: ',
      );
      await expect(failure).rejects.toThrow(/webgl:seed/);
      await expect(failure).rejects.toThrow(/newer:seed/);
    });

    it('is not a user-facing IdentityError', async () => {
      const failure = await drawIdentity(
        'windows',
        BOUND,
        deps({ unpinned: ['webgl:seed'] }),
      ).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(IdentityError);
    });

    it('is refused when Camoufox resolves no WebGL pair', async () => {
      await expect(
        drawIdentity('windows', BOUND, deps({ noWebgl: true })),
      ).rejects.toThrow('Camoufox resolved no WebGL vendor and renderer');
    });
  });
});

describe('createIdentity', () => {
  function setup(build: FakeBuild = {}) {
    const fake = fakeCamoufox(build);
    const deps: IdentityDeps = {
      launchOptions: fake.launchOptions,
      generate: fromPool(),
    };
    return { fake, deps };
  }

  async function signaturesOf(identity: Identity, deps: IdentityDeps) {
    return new Set(signatures(await resolvedConfig(identity, deps)));
  }

  it('draws identities that differ and summarizes the config', async () => {
    const { deps } = setup();
    const a = await createIdentity('windows', new Set(), {
      maxScreen: BOUND,
      deps,
    });
    const b = await createIdentity(
      'windows',
      new Set([a.visibleSignature, a.fullSignature]),
      { maxScreen: BOUND, deps },
    );
    expect(a.fullSignature).not.toBe(b.fullSignature);
    expect(a.visibleSignature).not.toBe(b.visibleSignature);
    expect(a.summary.platform).toBe('Win32');
    expect(a.summary.userAgent).toContain('Windows NT');
    const [width, height] = (a.summary.screen ?? '').split('x').map(Number);
    expect(width).toBeLessThanOrEqual(BOUND[0]);
    expect(height).toBeLessThanOrEqual(BOUND[1]);
    expect(a.summary.gpu).toBeTruthy();
  });

  it('returns the signatures and the summary of the config its identity resolves to', async () => {
    const { deps } = setup();
    const created = await createIdentity('macos', new Set(), {
      maxScreen: BOUND,
      deps,
    });
    const config = await resolvedConfig(created.identity, deps);
    expect([created.visibleSignature, created.fullSignature]).toEqual(
      signatures(config),
    );
    expect(created.summary).toEqual(summarize(config));
    expect(created.identity.os).toBe('macos');
    expect(created.summary.platform).toBe('MacIntel');
  });

  it('gives a stored identity the very signatures it was created with', async () => {
    const { deps } = setup();
    const created = await createIdentity('linux', new Set(), {
      maxScreen: BOUND,
      deps,
    });
    const reloaded = identityFromJson(identityToJson(created.identity));
    expect(signatures(await resolvedConfig(reloaded, deps))).toEqual([
      created.visibleSignature,
      created.fullSignature,
    ]);
  });

  it('draws again on a collision', async () => {
    const { deps } = setup();
    const taken = await drawIdentity('windows', BOUND, deps);
    const other = await drawIdentity('windows', BOUND, deps);
    const draw = vi
      .fn<NonNullable<IdentityDeps['draw']>>()
      .mockResolvedValueOnce(taken)
      .mockResolvedValueOnce(taken)
      .mockResolvedValueOnce(other);
    const created = await createIdentity(
      'windows',
      await signaturesOf(taken, deps),
      { maxScreen: BOUND, deps: { ...deps, draw } },
    );
    expect(created.identity).toEqual(other);
    expect(draw).toHaveBeenCalledTimes(3);
  });

  it('draws again when only one of the two signatures is taken', async () => {
    const { deps } = setup();
    const first = await drawIdentity('windows', BOUND, deps);
    const second = await drawIdentity('windows', BOUND, deps);
    const [visible, full] = signatures(await resolvedConfig(first, deps));
    for (const onlyTaken of [new Set([visible]), new Set([full])]) {
      const draw = vi
        .fn<NonNullable<IdentityDeps['draw']>>()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);
      const created = await createIdentity('windows', onlyTaken, {
        maxScreen: BOUND,
        deps: { ...deps, draw },
      });
      expect(created.identity).toEqual(second);
    }
  });

  it('takes a draw of the same fingerprint for another identity when its seeds differ', async () => {
    // the same device with other noise: it looks alike, but it is not the same identity
    const same: IdentityDeps = {
      launchOptions: fakeCamoufox({ webgl: [WEBGL_PAIRS[0]] }).launchOptions,
      generate: () => structuredClone(pool.windows[0]),
    };
    const existing = await drawIdentity('windows', BOUND, same);
    const lookalike = await drawIdentity('windows', BOUND, same);
    const [visible, full] = signatures(await resolvedConfig(existing, same));
    const [lookalikeVisible, lookalikeFull] = signatures(
      await resolvedConfig(lookalike, same),
    );
    expect(lookalikeVisible).toBe(visible);
    expect(lookalikeFull).not.toBe(full);

    // so it is no new session: the next draw is looked at
    const different = await drawIdentity('windows', BOUND, {
      ...same,
      generate: () => structuredClone(pool.windows[1]),
    });
    const draw = vi
      .fn<NonNullable<IdentityDeps['draw']>>()
      .mockResolvedValueOnce(lookalike)
      .mockResolvedValueOnce(different);
    const created = await createIdentity('windows', new Set([visible, full]), {
      maxScreen: BOUND,
      deps: { ...same, draw },
    });
    expect(draw).toHaveBeenCalledTimes(2);
    expect(created.identity).toEqual(different);
  });

  it('gives up with a clear message', async () => {
    const { deps } = setup();
    const only = await drawIdentity('windows', BOUND, deps);
    const draw = vi.fn(() => Promise.resolve(only));
    const failure = createIdentity('windows', await signaturesOf(only, deps), {
      maxScreen: BOUND,
      deps: { ...deps, draw },
    });
    await expect(failure).rejects.toThrow(IdentityError);
    await expect(failure).rejects.toThrow(
      'Could not generate a windows fingerprint that differs from all existing sessions in 30 tries. Try another OS.',
    );
    await expect(failure).rejects.toThrow('Try another OS');
    expect(draw).toHaveBeenCalledTimes(MAX_UNIQUE_TRIES);
    expect(MAX_UNIQUE_TRIES).toBe(30);
  });

  it('names the OS in the message', async () => {
    const { deps } = setup();
    const only = await drawIdentity('linux', BOUND, deps);
    await expect(
      createIdentity('linux', await signaturesOf(only, deps), {
        maxScreen: BOUND,
        deps: { ...deps, draw: () => Promise.resolve(only) },
      }),
    ).rejects.toThrow('Could not generate a linux fingerprint that differs');
  });

  it('hands the OS, the bound and its dependencies to the draw', async () => {
    const { deps } = setup();
    const identity = await drawIdentity('linux', BOUND, deps);
    const draw = vi.fn(() => Promise.resolve(identity));
    const all = { ...deps, draw };
    await createIdentity('linux', new Set(), { maxScreen: BOUND, deps: all });
    expect(draw).toHaveBeenCalledExactlyOnceWith('linux', BOUND, all);
  });

  it('draws for the largest screen unless given one', async () => {
    const { deps } = setup();
    const identity = await drawIdentity('linux', BOUND, deps);
    const draw = vi.fn<NonNullable<IdentityDeps['draw']>>(() =>
      Promise.resolve(identity),
    );
    vi.stubEnv('SESSION_MANAGER_MAX_SCREEN', '1280x720');
    await createIdentity('linux', new Set(), { deps: { ...deps, draw } });
    expect(draw.mock.calls[0][1]).toEqual([1280, 720]);
    vi.stubEnv('SESSION_MANAGER_MAX_SCREEN', '');
    await createIdentity('linux', new Set(), { deps: { ...deps, draw } });
    expect(draw.mock.calls[1][1]).toEqual([1920, 1080]);
  });

  it('picks an OS for "random"', async () => {
    const { deps } = setup();
    const created = await createIdentity('random', new Set(), {
      maxScreen: BOUND,
      deps: { ...deps, random: () => 0.7 },
    });
    expect(created.identity.os).toBe('macos');
  });

  it('refuses an OS it does not know before it draws anything', async () => {
    const { fake, deps } = setup();
    const generate = vi.fn(deps.generate);
    await expect(
      createIdentity('android', new Set(), {
        maxScreen: BOUND,
        deps: { ...deps, generate },
      }),
    ).rejects.toThrow(RangeError);
    expect(generate).not.toHaveBeenCalled();
    expect(fake.calls).toEqual([]);
  });

  it('passes on the problem when no identity can be drawn', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { deps } = setup();
    await expect(
      createIdentity('windows', new Set(), {
        maxScreen: [10, 10],
        deps: {
          ...deps,
          generate: () => {
            throw new Error('Failed to generate a consistent fingerprint');
          },
        },
      }),
    ).rejects.toThrow(
      'could not draw a windows fingerprint that fits a 10x10 screen',
    );
  });

  it('draws sessions that all look different', async () => {
    // fresh fingerprints from the generator: a pool would run out
    const deps: IdentityDeps = { launchOptions: fakeCamoufox().launchOptions };
    const taken = new Set<string>();
    const visible = new Set<string>();
    for (let n = 0; n < 12; n++) {
      const created = await createIdentity(n % 2 ? 'windows' : 'linux', taken, {
        maxScreen: BOUND,
        deps,
      });
      expect(taken.has(created.visibleSignature)).toBe(false);
      expect(taken.has(created.fullSignature)).toBe(false);
      taken.add(created.visibleSignature);
      taken.add(created.fullSignature);
      visible.add(created.visibleSignature);
    }
    expect(visible.size).toBe(12);
  });
});

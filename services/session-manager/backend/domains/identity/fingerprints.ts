// Per-session browser identities for camoufox-js.
//
// An identity is drawn once, at session creation, and stored (`types.ts`): the
// target OS, the fingerprint, the screen bound, the language, and everything
// else that `launchOptions` would draw at random on every launch (seeds, the
// WebGL pair, ...), pinned. Passing that back on every launch
// (`launch-options.ts`) resolves to the same Camoufox config each time.
//
// Resolving a config runs `launchOptions`, which reads the installed Camoufox
// build (its `properties.json`, its fonts): the build must be installed first.

import { createHash } from 'node:crypto';

import type { LaunchOptions } from 'camoufox-js';
import { FingerprintGenerator } from 'fingerprint-generator';
import type { Fingerprint } from 'fingerprint-generator';

import { isRecord } from '../../../lib/is-record.ts';
import { identityLaunchOptions } from './launch-options.ts';
import {
  IDENTITY_SCHEMA,
  IdentityError,
  identityFromJson,
  identityToJson,
} from './types.ts';
import type {
  GeneratedIdentity,
  Identity,
  IdentityOs,
  Summary,
} from './types.ts';

type Screen = Identity['maxScreen'];

/** What `launchOptions` of camoufox-js is given. */
export type LaunchArgs = Omit<LaunchOptions, 'headless'>;

/** The Camoufox config (what CAMOU_CONFIG holds) of an identity. */
export type ResolvedConfig = Record<string, unknown>;

export interface IdentityDeps {
  /** Default: `launchOptions` of camoufox-js, imported on first use. */
  launchOptions?: (options: LaunchArgs) => Promise<Record<string, unknown>>;
  /** One fingerprint for an OS within a screen bound. Default: Apify's generator, as camoufox-js uses it. */
  generate?: (os: IdentityOs, maxScreen: Screen) => Fingerprint;
  /** One complete draw, for `createIdentity`. Default: `drawIdentity`. */
  draw?: (
    os: IdentityOs,
    maxScreen: Screen,
    deps: IdentityDeps,
  ) => Promise<Identity>;
  /** For the OS pick; default `Math.random`. */
  random?: () => number;
}

export interface CreateIdentityOptions {
  /** The largest screen to draw for. Default: `largestScreen()`. */
  maxScreen?: Screen;
  deps?: IdentityDeps;
}

/**
 * What "random" picks from, and how often: Windows three times as often as
 * macOS. Never Linux: so few people browse the web on it that a Linux
 * fingerprint stands out, so a session only has one when it is chosen.
 */
export const RANDOM_OS_WEIGHTS = {
  windows: 0.75,
  macos: 0.25,
} as const satisfies Partial<Record<IdentityOs, number>>;
const RANDOM_OS_NAMES = [
  'windows',
  'macos',
] as const satisfies readonly (keyof typeof RANDOM_OS_WEIGHTS)[];
export const OS_CHOICES = ['random', 'windows', 'macos', 'linux'] as const;
const OS_NAMES = ['windows', 'macos', 'linux'] as const;

/** Used when `SESSION_MANAGER_MAX_SCREEN` says nothing usable. */
export const FALLBACK_SCREEN: Readonly<Screen> = [1920, 1080];
export const MAX_UNIQUE_TRIES = 30;
const MAX_DRAWS = 500;
const MAX_GENERATOR_FAILURES = 3;

// Camoufox values that `launchOptions` draws at random on every launch, unless
// the caller's config has them: pinned, they make every launch of an identity
// resolve to the same config. `window.screenY` is one of them for a window that
// sits off-screen (a second monitor). Only the keys the installed build knows
// are in a resolved config, and so are pinned: `audio:seed` and `canvas:seed`
// came with Camoufox 2.0.
const PINNED_KEYS = [
  'fonts:spacing_seed',
  'audio:seed',
  'canvas:seed',
  'window.history.length',
  'canvas:aaOffset',
  'window.screenY',
] as const;

// Resolved-config keys left out of the signatures: geo values follow the proxy's
// exit IP, and addons holds local file paths.
const GEO_KEYS = ['timezone', 'locale:', 'geolocation:', 'webrtc:'];
// Noise: it makes two identities hash differently without making them look like
// different devices. The seeds, the history length and the antialiasing offset
// are random by construction; `window.screenY` follows from `window.screenX`
// or is random; media devices are permission-gated lists.
const NOISE_KEYS = [
  'audio:seed',
  'canvas:seed',
  'canvas:aa',
  'fonts:spacing_seed',
  'window.history.length',
  'window.screenY',
  'mediaDevices',
];

/**
 * Resolve "random" to a weighted pick of Windows or macOS
 * (`RANDOM_OS_WEIGHTS`); pass explicit OS names through.
 */
export function pickOs(
  choice: string,
  random: () => number = Math.random,
): IdentityOs {
  if (choice === 'random') {
    let threshold =
      random() *
      RANDOM_OS_NAMES.reduce((sum, name) => sum + RANDOM_OS_WEIGHTS[name], 0);
    for (const name of RANDOM_OS_NAMES) {
      threshold -= RANDOM_OS_WEIGHTS[name];
      if (threshold < 0) return name;
    }
    return RANDOM_OS_NAMES[RANDOM_OS_NAMES.length - 1];
  }
  const os = OS_NAMES.find((name) => name === choice);
  if (os) return os;
  throw new RangeError(`os must be one of ${OS_CHOICES.join(', ')}`);
}

/**
 * The largest screen an identity may have. JavaScript cannot ask for the
 * attached displays, so it is `SESSION_MANAGER_MAX_SCREEN` ("1920x1080"), else
 * 1920x1080. Without a bound a fingerprint can have a screen larger than the
 * host's.
 */
export function largestScreen(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Screen {
  const raw = env.SESSION_MANAGER_MAX_SCREEN?.trim();
  if (!raw) return [...FALLBACK_SCREEN];
  const match = /^(\d{1,5})\s*[x×]\s*(\d{1,5})$/iu.exec(raw);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!match || width < 1 || height < 1) {
    console.warn(
      `ignoring SESSION_MANAGER_MAX_SCREEN=${JSON.stringify(raw)}: expected WIDTHxHEIGHT, for example 1920x1080`,
    );
    return [...FALLBACK_SCREEN];
  }
  return [width, height];
}

let generator: FingerprintGenerator | undefined;

function generateFingerprint(
  os: IdentityOs,
  [maxWidth, maxHeight]: Screen,
): Fingerprint {
  // The options camoufox-js draws its own fingerprints with.
  generator ??= new FingerprintGenerator({
    browsers: ['firefox'],
    operatingSystems: ['linux', 'macos', 'windows'],
  });
  return generator.getFingerprint({
    screen: { maxWidth, maxHeight },
    operatingSystems: [os],
  }).fingerprint;
}

function drawFingerprint(
  os: IdentityOs,
  maxScreen: Screen,
  generate: NonNullable<IdentityDeps['generate']>,
): Fingerprint {
  const [width, height] = maxScreen;
  let failures = 0;
  let failure: Error | undefined;
  for (let draw = 0; draw < MAX_DRAWS; draw++) {
    let fingerprint: Fingerprint;
    try {
      fingerprint = generate(os, maxScreen);
    } catch (error) {
      // The generator gave up after ten tries of its own: it has no
      // fingerprint of this OS for this screen, and asking again does not help.
      failure = error instanceof Error ? error : new Error(String(error));
      failures += 1;
      if (failures >= MAX_GENERATOR_FAILURES) break;
      continue;
    }
    // The generator drops a screen bound that it cannot meet.
    if (
      fingerprint.screen.width > width ||
      fingerprint.screen.height > height
    ) {
      continue;
    }
    // The generator's data has no `navigator.oscpu` (`null`) for about 4 % of
    // its Windows fingerprints. Camoufox leaves the value alone then, and the
    // page would read the computer's own OS under another OS's user agent.
    const { oscpu } = fingerprint.navigator;
    if (typeof oscpu !== 'string' || oscpu === '') continue;
    return fingerprint;
  }
  const error = new IdentityError(
    `could not draw a ${os} fingerprint that fits a ${width}x${height} screen`,
  );
  if (failure) {
    error.cause = failure;
    console.warn(
      `the fingerprint generator has no ${os} fingerprint for a ${width}x${height} screen: ${failure.message}`,
    );
  }
  throw error;
}

/** The identity as the database gives it back: what is hashed now must equal what is loaded later. */
function stored(identity: Identity): Identity {
  return identityFromJson(identityToJson(identity));
}

function pinnedValues(config: ResolvedConfig): Identity['pinned'] {
  const pinned: Identity['pinned'] = {};
  for (const key of PINNED_KEYS) {
    const value = config[key];
    if (typeof value === 'number' || typeof value === 'boolean') {
      pinned[key] = value;
    }
  }
  return pinned;
}

function webglPair(config: ResolvedConfig): Identity['webgl'] {
  const vendor = config['webGl:vendor'];
  const renderer = config['webGl:renderer'];
  if (typeof vendor !== 'string' || typeof renderer !== 'string') {
    throw new Error('Camoufox resolved no WebGL vendor and renderer');
  }
  return [vendor, renderer];
}

function differingKeys(a: ResolvedConfig, b: ResolvedConfig): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (key) =>
      !(key in a) ||
      !(key in b) ||
      canonicalJson(a[key]) !== canonicalJson(b[key]),
  );
}

/**
 * One draw: a fingerprint of the OS that fits `maxScreen`, with everything that
 * Camoufox would draw at random on each launch pinned (see `PINNED_KEYS`).
 *
 * Camoufox resolves the fingerprint once and what it drew is kept; a second
 * resolution has to give the very same config, or the draw is refused.
 */
export async function drawIdentity(
  os: IdentityOs,
  maxScreen: Screen,
  deps: IdentityDeps = {},
): Promise<Identity> {
  const fingerprint = drawFingerprint(
    os,
    maxScreen,
    deps.generate ?? generateFingerprint,
  );
  // Nothing is pinned yet: Camoufox draws the first resolution as it would draw
  // a launch (no WebGL pair given), and what it drew is then pinned.
  const draft = stored({
    schema: IDENTITY_SCHEMA,
    os,
    fingerprint,
    pinned: {},
    webgl: ['', ''],
    maxScreen: [...maxScreen],
    locale: null,
  });
  const drawn = await resolve(
    { ...identityLaunchOptions(draft), webgl_config: undefined },
    deps,
  );
  const identity = stored({
    ...draft,
    pinned: pinnedValues(drawn),
    webgl: webglPair(drawn),
  });
  const differing = differingKeys(drawn, await resolvedConfig(identity, deps));
  if (differing.length > 0) {
    throw new Error(
      `a ${os} identity does not resolve to the same Camoufox config twice (differs at: ${differing.join(', ')})`,
    );
  }
  return identity;
}

/** The Camoufox config (CAMOU_CONFIG) the identity resolves to, without launching a browser. */
export function resolvedConfig(
  identity: Identity,
  deps: IdentityDeps = {},
): Promise<ResolvedConfig> {
  return resolve(identityLaunchOptions(identity), deps);
}

async function resolve(
  options: LaunchArgs,
  deps: IdentityDeps,
): Promise<ResolvedConfig> {
  const launchOptions = deps.launchOptions ?? (await loadLaunchOptions());
  return configOf(
    await launchOptions({
      ...options,
      // Else the default add-on (uBlock Origin) is downloaded for a config that
      // is only read; add-ons are no part of an identity.
      exclude_addons: ['UBO'],
      // Else the result holds a copy of process.env: never store or log it.
      env: {},
    }),
  );
}

/** The config that `launchOptions` handed to the browser, in chunks of CAMOU_CONFIG_<n>. */
function configOf(launched: Record<string, unknown>): ResolvedConfig {
  const env = launched.env;
  if (!isRecord(env)) throw new Error('camoufox-js returned no environment');
  const chunks: [index: number, text: string][] = [];
  for (const [key, value] of Object.entries(env)) {
    const index = /^CAMOU_CONFIG_(\d+)$/u.exec(key)?.[1];
    if (index !== undefined && typeof value === 'string') {
      chunks.push([Number(index), value]);
    }
  }
  if (chunks.length === 0) {
    throw new Error('camoufox-js returned no CAMOU_CONFIG');
  }
  const config: unknown = JSON.parse(
    chunks
      .sort(([a], [b]) => a - b)
      .map(([, text]) => text)
      .join(''),
  );
  if (!isRecord(config)) throw new Error('CAMOU_CONFIG is not a JSON object');
  return config;
}

function startsWithAny(key: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => key.startsWith(prefix));
}

/** (visible, full) signature of a resolved config; both must be unique across sessions. */
export function signatures(
  config: Readonly<ResolvedConfig>,
): [visible: string, full: string] {
  const full = Object.entries(config).filter(
    ([key]) => key !== 'addons' && !startsWithAny(key, GEO_KEYS),
  );
  const visible = full.filter(([key]) => !startsWithAny(key, NOISE_KEYS));
  return [digest(visible), digest(full)];
}

function digest(entries: readonly (readonly [string, unknown])[]): string {
  return createHash('sha256')
    .update(canonicalJson(Object.fromEntries(entries)))
    .digest('hex');
}

/** JSON with the keys of every object sorted: the same data always hashes the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    const members = Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${members.join(',')}}`;
  }
  return value === undefined ? 'null' : JSON.stringify(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function summarize(config: Readonly<ResolvedConfig>): Summary {
  const width = config['screen.width'];
  const height = config['screen.height'];
  return {
    userAgent: textOrNull(config['navigator.userAgent']),
    platform: textOrNull(config['navigator.platform']),
    screen:
      typeof width === 'number' &&
      typeof height === 'number' &&
      width > 0 &&
      height > 0
        ? `${width}x${height}`
        : null,
    gpu: textOrNull(config['webGl:renderer']),
  };
}

/**
 * Draw identities until both signatures differ from every signature in
 * `taken`. `os` is an OS name, or "random".
 */
export async function createIdentity(
  os: string,
  taken: ReadonlySet<string>,
  options: CreateIdentityOptions = {},
): Promise<GeneratedIdentity> {
  const deps = options.deps ?? {};
  const target = pickOs(os, deps.random);
  const bound = options.maxScreen ?? largestScreen();
  const draw = deps.draw ?? drawIdentity;
  for (let attempt = 0; attempt < MAX_UNIQUE_TRIES; attempt++) {
    const identity = await draw(target, bound, deps);
    const config = await resolvedConfig(identity, deps);
    const [visible, full] = signatures(config);
    if (!taken.has(visible) && !taken.has(full)) {
      return {
        identity,
        visibleSignature: visible,
        fullSignature: full,
        summary: summarize(config),
      };
    }
  }
  throw new IdentityError(
    `Could not generate a ${target} fingerprint that differs from all existing sessions in ${MAX_UNIQUE_TRIES} tries. Try another OS.`,
  );
}

// camoufox-js reads CAMOUFOX_INSTALL_DIR when it is first imported (the browser
// build lives there) and the app sets it at startup, so it is imported when it
// is first needed, not at the top of this file.
async function loadLaunchOptions(): Promise<
  NonNullable<IdentityDeps['launchOptions']>
> {
  const { launchOptions } = await import('camoufox-js');
  return launchOptions;
}

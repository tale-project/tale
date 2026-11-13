import { BUNDLED_OBJECT_STORE_ENDPOINT } from '../../../compose/generators/constants';
import type { DeploymentColor } from '../../../compose/types';
import {
  EGRESS_PROXY_VARIABLE,
  incusImage,
  incusSandboxVariables,
  isUnicastIpv4,
  SANDBOX_DOCKER_ONLY_VARIABLES,
  SANDBOX_INCUS_MOUNT_POINT,
  SANDBOX_INCUS_MOUNT_SOURCE,
  SANDBOX_SHAPE_MOUNTS,
  type SandboxRuntimeImage,
} from '../../../deployment/runtime-sandbox';
import { TALE_INIT_LABEL, type ImageFacts } from '../../../oci/image-facts';
import {
  mirrorOf,
  parseImageReference,
  type RegistryMirrors,
} from '../../../oci/registry';
import type { AddressPlan } from './address-plan';
import { interpolateDeep, parseDotenv, type Lookup } from './interpolate';
import { PROFILE_LIMITS, placementOf, type PlacementRow } from './placement';
import { refusal, RefusalError, type Refusal } from './refusals';
import { ruleOf } from './rules';

/**
 * One compose service onto Incus instance definitions (design 6, 6.1). Pure:
 * everything it reads arrives as an argument, and everything it cannot carry
 * over is a refusal with its reason rather than a silent difference from
 * Docker Compose.
 */

/** The init the stack's own images ship at `/init` (design D-21, D-22). */
export const PATCHED_INIT = 'dumb-init-1.2.5+maxsig64';
/** The signals liblxc sends PID 1 to halt an instance: SIGPWR, and
 * SIGRTMIN+3 and +4, which only the patched init can rewrite. */
const HALT_SIGNALS = [30, 37, 38] as const;
/** Docker's stop grace when a service declares none. */
const DEFAULT_GRACE_SECONDS = 10;
const DEFAULT_STOP_SIGNAL = 15;
/** Docker's health check defaults. */
const HEALTH_DEFAULTS = {
  intervalMs: 30_000,
  timeoutMs: 30_000,
  retries: 3,
  startPeriodMs: 0,
} as const;

/** Capabilities an unprivileged instance's root already holds in its user
 * namespace (design 6.1). */
const NAMESPACED_CAPABILITIES = new Set([
  'NET_ADMIN',
  'NET_BIND_SERVICE',
  'CHOWN',
  'SETUID',
  'SETGID',
  'DAC_OVERRIDE',
  'KILL',
]);
/** The kernel limits Incus sets by name (`limits.kernel.*`). */
const KERNEL_LIMITS = new Set([
  'as',
  'core',
  'cpu',
  'data',
  'fsize',
  'locks',
  'memlock',
  'msgqueue',
  'nice',
  'nofile',
  'nproc',
  'rss',
  'rtprio',
  'rttime',
  'sigpending',
  'stack',
]);
const SIGNALS: Record<string, number> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGUSR1: 10,
  SIGUSR2: 12,
  SIGTERM: 15,
  SIGWINCH: 28,
  SIGPWR: 30,
};
const RESTART_POLICIES = /^(no|always|unless-stopped|on-failure(:\d+)?)$/;
const STACK_NETWORKS = new Set(['internal', 'sandbox']);
/** The .env file a service may read; every other env_file is refused. */
const DOTENV_FILE = '.env';
/** The bundle's Caddyfile, copied onto the `proxy-files` volume. */
const BUNDLE_CADDYFILE_BIND = './Caddyfile.production:/etc/caddy/Caddyfile:ro';
/** The roles the switch holds by name, on the ports it listens on. */
export const SWITCHED_ROLES = { platform: 3000, 'backend-api': 3005 } as const;

/** Volumes the runtime renders itself and never snapshots (design D-28a). */
export const RUNTIME_VOLUMES = {
  'proxy-files': 'the managed bundle Caddyfile',
  'sandbox-credentials': "the spawner's Incus client certificate and key",
  'names-config': 'the stack resolvers: dnsmasq.conf and the host records',
  'switch-config': "the switch's upstream lists",
} as const;
export type RuntimeVolume = keyof typeof RUNTIME_VOLUMES;

export type Devices = Record<string, Record<string, string>>;

export interface Healthcheck {
  /** `["CMD", …]` or `["CMD-SHELL", "…"]`, interpolated. */
  test: string[];
  intervalMs: number;
  timeoutMs: number;
  retries: number;
  startPeriodMs: number;
}

/** The label an instance carries its healthcheck in, as JSON. */
export const HEALTH_LABEL = 'user.tale.health';

/** The healthcheck an instance carries (`HEALTH_LABEL`); undefined when it
 * carries none or one that does not read as a healthcheck. */
export function healthcheckFromLabel(
  value: string | undefined,
): Healthcheck | { disabled: true } | undefined {
  if (value === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    console.warn(
      `${HEALTH_LABEL} is no JSON:`,
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  if (record.disabled === true) return { disabled: true };
  const numbers = [
    'intervalMs',
    'timeoutMs',
    'retries',
    'startPeriodMs',
  ] as const;
  if (
    !Array.isArray(record.test) ||
    !record.test.every((word) => typeof word === 'string') ||
    !numbers.every(
      (key) => typeof record[key] === 'number' && Number.isFinite(record[key]),
    )
  )
    return undefined;
  return {
    test: record.test as string[],
    intervalMs: record.intervalMs as number,
    timeoutMs: record.timeoutMs as number,
    retries: record.retries as number,
    startPeriodMs: record.startPeriodMs as number,
  };
}

export interface StopContract {
  /** The signal the process gets, by number. */
  signal: number;
  /** Seconds before a stop turns forced. */
  graceSeconds: number;
}

export interface InstanceSpec {
  /** The Incus instance name. */
  name: string;
  /** The compose service, or the runtime's own role. */
  service: string;
  /** 1-based replica index of a slot role; null for a singleton. */
  index: number | null;
  colour: DeploymentColor | null;
  /** The image alias the instance is created from. */
  image: string;
  address: string;
  /** Instance config: oci.*, environment.*, limits.*, boot.*, security.*,
   * linux.sysctl.*, user.tale.*. */
  config: Record<string, string>;
  devices: Devices;
  healthcheck: Healthcheck | { disabled: true };
  stop: StopContract;
  dependsOn: { service: string; condition: string }[];
}

export interface FileSpec {
  volume: RuntimeVolume;
  /** The file's path inside the volume. */
  path: string;
  mode: number;
  /** A file of the managed bundle, or one of the spawner's credentials. */
  source:
    | { kind: 'bundle'; file: string }
    | { kind: 'sandbox-credentials'; file: string };
}

export interface ServiceContext {
  path: 'workspace' | 'managed';
  stack: string;
  plan: AddressPlan;
  pool: string;
  bridge: string;
  architecture: string;
  variables: Readonly<Record<string, string>>;
  envFiles: Readonly<Record<string, string>>;
  images: Readonly<Record<string, ImageFacts>>;
  replicas: Readonly<Record<string, number>>;
  sandboxRuntime?: SandboxRuntimeImage;
  /** The declared egress proxy the spawner hands its sessions, if any. */
  egressProxy?: string;
  /** The Incus API the spawner dials. */
  endpoint: string;
  ingress: { mode: 'routed' | 'proxy-device'; listen?: string };
  /** The declared registry mirrors, which the sessions' image is pulled
   * through as the stack's own images are. */
  mirrors?: RegistryMirrors;
  /** A workspace's sandbox zone, by the spawner's variables, for those its
   * `.env` names none of (`sessions-zone.ts`). */
  sessionsZone?: Readonly<Record<string, string>>;
}

/** The sessions' image source as the spawner pulls it: through the mirror
 * declared for its registry, by the same repository and digest. */
function mirroredSource(source: string, mirrors?: RegistryMirrors): string {
  const reference = parseImageReference(source);
  const host = mirrorOf(reference.registry, mirrors);
  return host === undefined || reference.digest === null
    ? source
    : `${host}/${reference.repository}@${reference.digest}`;
}

export interface TranslatedService {
  service: string;
  instances: InstanceSpec[];
  /** Data volumes the service mounts, by logical name. */
  dataVolumes: string[];
  runtimeVolumes: RuntimeVolume[];
  files: FileSpec[];
  /** Names of the stack view, by name: what the service adds. */
  names: Record<string, string[]>;
  /** The proxy's published ports, kept for the ingress. */
  ingressPorts: { host: number; container: number }[];
  /** Keys dropped under an `ignore` rule or a recorded exception. */
  ignored: { key: string; reason: string }[];
  /** The image alias, its facts and the services running it. */
  image: { alias: string; facts: ImageFacts } | null;
  /** True when the service is left out of the stack (D-36). */
  omitted?: string;
}

const lookupIn =
  (variables: Readonly<Record<string, string>>): Lookup =>
  (name) =>
    Object.hasOwn(variables, name) ? variables[name] : undefined;

/** The image alias of `facts`: its repository's last segment and digest. */
export function imageAlias(
  facts: Pick<ImageFacts, 'reference' | 'digest'>,
): string {
  const repository = facts.reference.split('@')[0] ?? '';
  const name = repository
    .slice(repository.lastIndexOf('/') + 1)
    .replace(/:.*$/, '');
  const prefixed = name.startsWith('tale-') ? name : `tale-${name}`;
  return `${prefixed}-${facts.digest.replace(/^sha256:/, '').slice(0, 32)}`;
}

// --- words ----------------------------------------------------------------

/** Split a command as a POSIX shell does (Compose's string `command`, and
 * Incus's `shellquote.Split` of `oci.entrypoint`). */
export function splitWords(text: string): string[] {
  const words: string[] = [];
  let word = '';
  let started = false;
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? '';
    if (/\s/.test(char)) {
      if (started) words.push(word);
      word = '';
      started = false;
      index += 1;
      continue;
    }
    started = true;
    if (char === "'") {
      const end = text.indexOf("'", index + 1);
      if (end === -1) throw new Error('unterminated single quote');
      word += text.slice(index + 1, end);
      index = end + 1;
      continue;
    }
    if (char === '"') {
      index += 1;
      for (;;) {
        const next = text[index];
        if (next === undefined) throw new Error('unterminated double quote');
        if (next === '"') break;
        if (next === '\\' && /["\\$`\n]/.test(text[index + 1] ?? '')) {
          if (text[index + 1] !== '\n') word += text[index + 1];
          index += 2;
          continue;
        }
        word += next;
        index += 1;
      }
      index += 1;
      continue;
    }
    if (char === '\\') {
      const next = text[index + 1];
      if (next === undefined) throw new Error('trailing backslash');
      if (next !== '\n') word += next;
      index += 2;
      continue;
    }
    word += char;
    index += 1;
  }
  if (started) words.push(word);
  return words;
}

/** Quote one word for `shellquote.Split`. */
function quoteWord(word: string): string {
  if (word !== '' && /^[A-Za-z0-9_@%+=:,./-]+$/.test(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/** `words` as one `oci.entrypoint` string, or null when a word cannot
 * survive Incus's split (a NUL or a line break). */
export function joinWords(words: readonly string[]): string | null {
  if (words.some((word) => /[\0\n\r]/.test(word))) return null;
  const joined = words.map(quoteWord).join(' ');
  const back = splitWords(joined);
  return back.length === words.length &&
    back.every((word, index) => word === words[index])
    ? joined
    : null;
}

// --- values ---------------------------------------------------------------

const DURATION_UNITS: Record<string, number> = {
  ns: 1e-6,
  us: 1e-3,
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

/** A Compose (Go) duration in milliseconds, or null. */
export function parseDuration(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
    return value * 1000;
  if (typeof value !== 'string' || value === '') return null;
  if (value === '0') return 0;
  const pattern = /(\d+(?:\.\d+)?)(ns|us|ms|s|m|h)/gy;
  let total = 0;
  let consumed = 0;
  for (const match of value.matchAll(pattern)) {
    total += Number(match[1]) * (DURATION_UNITS[match[2] ?? ''] ?? Number.NaN);
    consumed += match[0].length;
  }
  return consumed === value.length && Number.isFinite(total)
    ? Math.round(total)
    : null;
}

const SIZE_UNITS: Record<string, number> = {
  '': 1,
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
};

/** A Compose byte size (`512m`, `12g`, `256mb`) in bytes, or null. */
export function parseSize(value: unknown): number | null {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const match = /^(\d+)([a-z]*)$/i.exec(value.trim());
  const unit = SIZE_UNITS[(match?.[2] ?? '').toLowerCase()];
  if (!match || unit === undefined) return null;
  const bytes = Number(match[1]) * unit;
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
}

/** Bytes as Incus writes a size: the largest binary unit that divides it. */
function incusSize(bytes: number): string {
  for (const [unit, size] of [
    ['GiB', 1024 ** 3],
    ['MiB', 1024 ** 2],
    ['KiB', 1024],
  ] as const)
    if (bytes % size === 0) return `${bytes / size}${unit}`;
  return String(bytes);
}

/** Bytes as the tale-db entrypoint reads TALE_SHM_SIZE (`256m`). */
function shmSize(bytes: number): string {
  for (const [unit, size] of [
    ['g', 1024 ** 3],
    ['m', 1024 ** 2],
    ['k', 1024],
  ] as const)
    if (bytes % size === 0) return `${bytes / size}${unit}`;
  return String(bytes);
}

/** A signal name or number as its number, or null. */
export function signalNumber(value: unknown): number | null {
  if (typeof value === 'number')
    return Number.isInteger(value) && value > 0 && value < 65 ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().toUpperCase();
  if (/^\d+$/.test(text)) return signalNumber(Number(text));
  return SIGNALS[text.startsWith('SIG') ? text : `SIG${text}`] ?? null;
}

// --- the service -----------------------------------------------------------

interface VolumeMount {
  source: string;
  target: string;
  readOnly: boolean;
}

function parseVolume(entry: string): VolumeMount | null {
  const parts = entry.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const [source = '', target = '', mode = 'rw'] = parts;
  const modes = mode.split(',');
  if (!target.startsWith('/') || !modes.every((m) => /^(ro|rw|z|Z)$/.test(m)))
    return null;
  return { source, target, readOnly: modes.includes('ro') };
}

const isNamedVolume = (source: string): boolean =>
  /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(source);

/** The env_file entries of a service as `{path, required}`. */
function envFileEntries(
  value: unknown,
): { path: string; required: boolean }[] | null {
  const list = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(list)) return null;
  const entries: { path: string; required: boolean }[] = [];
  for (const item of list) {
    if (typeof item === 'string') entries.push({ path: item, required: true });
    else if (
      item !== null &&
      typeof item === 'object' &&
      typeof (item as { path?: unknown }).path === 'string'
    ) {
      const { path, required } = item as { path: string; required?: unknown };
      entries.push({ path, required: required !== false });
    } else return null;
  }
  return entries;
}

function environmentEntries(value: unknown): [string, string | null][] | null {
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    const entries: [string, string | null][] = [];
    for (const item of value) {
      if (typeof item !== 'string') return null;
      const equals = item.indexOf('=');
      entries.push(
        equals === -1
          ? [item, null]
          : [item.slice(0, equals), item.slice(equals + 1)],
      );
    }
    return entries;
  }
  if (value === null || typeof value !== 'object') return null;
  return Object.entries(value).map(([key, item]) => [
    key,
    item === null || item === undefined ? null : String(item),
  ]);
}

/** Compose's sysctls, as a mapping or a list of `key=value`. */
function sysctlEntries(value: unknown): [string, string][] | null {
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    const entries: [string, string][] = [];
    for (const item of value) {
      if (typeof item !== 'string') return null;
      const equals = item.indexOf('=');
      if (equals < 1) return null;
      entries.push([item.slice(0, equals), item.slice(equals + 1)]);
    }
    return entries;
  }
  if (value === null || typeof value !== 'object') return null;
  const entries = Object.entries(value);
  return entries.every(([, item]) =>
    ['string', 'number', 'boolean'].includes(typeof item),
  )
    ? entries.map(([key, item]) => [key, String(item)])
    : null;
}

function stringList(value: unknown): string[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : null;
}

/** The networks of a service and the aliases it asks for on them. */
function networkAliases(
  value: unknown,
): { networks: string[]; aliases: string[] } | null {
  if (value === undefined) return { networks: ['default'], aliases: [] };
  if (Array.isArray(value))
    return value.every((item) => typeof item === 'string')
      ? { networks: value, aliases: [] }
      : null;
  if (value === null || typeof value !== 'object') return null;
  const aliases: string[] = [];
  for (const settings of Object.values(value)) {
    if (settings === null || settings === undefined) continue;
    const listed = (settings as { aliases?: unknown }).aliases;
    if (listed === undefined) continue;
    if (!Array.isArray(listed) || !listed.every((a) => typeof a === 'string'))
      return null;
    aliases.push(...listed);
  }
  return { networks: Object.keys(value), aliases };
}

function dependencies(
  value: unknown,
): { service: string; condition: string }[] | null {
  if (value === undefined) return [];
  if (Array.isArray(value))
    return value.every((item) => typeof item === 'string')
      ? value.map((service) => ({ service, condition: 'service_started' }))
      : null;
  if (value === null || typeof value !== 'object') return null;
  return Object.entries(value).map(([service, settings]) => ({
    service,
    condition:
      typeof (settings as { condition?: unknown } | null)?.condition ===
      'string'
        ? (settings as { condition: string }).condition
        : 'service_started',
  }));
}

/** A name the stack resolver can answer. */
export const DNS_NAME =
  /^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** The words a service runs, before `/init`: Compose's override rules over
 * the image's entrypoint and command, with a leading tini dropped (the
 * patched init reaps in its place). */
function commandWords(
  service: Record<string, unknown>,
  facts: ImageFacts,
): string[] | Refusal {
  const words = (key: 'entrypoint' | 'command'): string[] | null | Refusal => {
    const value = service[key];
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') {
      try {
        return splitWords(value);
      } catch (error) {
        return refusal(
          'entrypoint-words',
          `The ${key} cannot be split into words (${(error as Error).message}).`,
          null,
          key,
        );
      }
    }
    if (Array.isArray(value) && value.every((item) => typeof item === 'string'))
      return value;
    return refusal(
      'entrypoint-words',
      `The ${key} is neither a string nor a list of strings.`,
      null,
      key,
    );
  };
  const entrypoint = words('entrypoint');
  const command = words('command');
  if (entrypoint !== null && !Array.isArray(entrypoint)) return entrypoint;
  if (command !== null && !Array.isArray(command)) return command;
  // Compose: an entrypoint override drops the image's command.
  const run = [
    ...(entrypoint ?? facts.entrypoint ?? []),
    ...(command ?? (entrypoint === null ? (facts.cmd ?? []) : [])),
  ];
  const first = run[0] ?? '';
  if (/(^|\/)tini(-static)?$/.test(first))
    return run.slice(run[1] === '--' ? 2 : 1);
  return run;
}

/** `oci.entrypoint`: the patched init in front, rewriting the halt signals
 * to the service's stop signal, or the command alone on an accepted image. */
export function ociEntrypoint(
  words: readonly string[],
  signal: number,
  init: boolean,
): string | null {
  return joinWords(
    init
      ? [
          '/init',
          '--single-child',
          ...HALT_SIGNALS.flatMap((halt) => ['--rewrite', `${halt}:${signal}`]),
          '--',
          ...words,
        ]
      : words,
  );
}

function healthcheckOf(
  value: unknown,
): Healthcheck | { disabled: true } | 'missing' | string {
  if (value === undefined || value === null) return 'missing';
  if (typeof value !== 'object') return 'is not a mapping';
  const health = value as Record<string, unknown>;
  if (health.disable === true) return { disabled: true };
  const test =
    typeof health.test === 'string'
      ? ['CMD-SHELL', health.test]
      : Array.isArray(health.test) &&
          health.test.every((item) => typeof item === 'string')
        ? (health.test as string[])
        : null;
  if (test === null || test.length === 0) return 'has no test';
  if (test[0] === 'NONE') return { disabled: true };
  if (test[0] !== 'CMD' && test[0] !== 'CMD-SHELL')
    return `test starts with "${test[0]}", not CMD or CMD-SHELL`;
  const durations = {} as Record<
    'intervalMs' | 'timeoutMs' | 'startPeriodMs',
    number
  >;
  for (const [key, field] of [
    ['interval', 'intervalMs'],
    ['timeout', 'timeoutMs'],
    ['start_period', 'startPeriodMs'],
  ] as const) {
    if (health[key] === undefined) {
      durations[field] = HEALTH_DEFAULTS[field];
      continue;
    }
    const ms = parseDuration(health[key]);
    if (ms === null) return `${key} "${String(health[key])}" is no duration`;
    durations[field] = ms;
  }
  const retries = health.retries ?? HEALTH_DEFAULTS.retries;
  if (typeof retries !== 'number' || !Number.isInteger(retries) || retries < 1)
    return `retries "${String(retries)}" is no positive whole number`;
  return { test, ...durations, retries };
}

/** Where a translation step reports: refusals, and keys dropped by rule. */
interface Report {
  refuse(item: Refusal, key?: string | null): void;
  ignored: { key: string; reason: string }[];
}

/**
 * The disk devices of a service: named volumes, the runtime volumes that
 * replace the binds Tale's own compose sources use, and the files the runtime
 * writes onto them. An image volume no mount covers is refused, and so is a
 * data-holding service on an image without the patched init (D-22).
 */
function mountsOf(
  name: string,
  service: Record<string, unknown>,
  facts: ImageFacts,
  row: PlacementRow,
  context: ServiceContext,
  { refuse, ignored }: Report,
): {
  devices: Devices;
  dataVolumes: string[];
  runtimeVolumes: RuntimeVolume[];
  files: FileSpec[];
} {
  const init = facts.init === PATCHED_INIT;
  const devices: Devices = {};
  const dataVolumes: string[] = [];
  const runtimeVolumes: RuntimeVolume[] = [];
  const files: FileSpec[] = [];
  const volumeEntries = stringList(service.volumes);
  if (volumeEntries === null)
    refuse(
      refusal(
        'bind-mount',
        'The volume list holds an entry in the long syntax.',
      ),
      'volumes',
    );
  const dockerOnlyMounts = new Set(
    SANDBOX_SHAPE_MOUNTS.docker.filter(
      (mount) => !SANDBOX_SHAPE_MOUNTS.incus.includes(mount),
    ),
  );
  const addDisk = (volume: string, target: string, readOnly: boolean): void => {
    devices[volume] = {
      type: 'disk',
      pool: context.pool,
      source: volume,
      path: target,
      ...(readOnly ? { readonly: 'true' } : {}),
    };
  };
  for (const entry of volumeEntries ?? []) {
    if (name === 'sandbox' && dockerOnlyMounts.has(entry)) {
      ignored.push({
        key: 'volumes',
        reason: `${entry.split(':')[0]} belongs to the Docker sandbox shape; the spawner runs its sessions on Incus`,
      });
      continue;
    }
    if (name === 'proxy' && entry === BUNDLE_CADDYFILE_BIND) {
      addDisk('proxy-files', '/etc/caddy', true);
      runtimeVolumes.push('proxy-files');
      files.push({
        volume: 'proxy-files',
        path: 'Caddyfile',
        mode: 0o644,
        source: { kind: 'bundle', file: 'Caddyfile.production' },
      });
      continue;
    }
    const mount = parseVolume(entry);
    if (
      name === 'sandbox' &&
      mount !== null &&
      mount.source === SANDBOX_INCUS_MOUNT_SOURCE &&
      mount.target === SANDBOX_INCUS_MOUNT_POINT
    )
      continue; // the credentials are mounted below, for both shapes
    if (mount === null || !isNamedVolume(mount.source)) {
      refuse(
        refusal('bind-mount', `"${entry}" mounts a host path.`),
        'volumes',
      );
      continue;
    }
    addDisk(mount.source, mount.target, mount.readOnly);
    dataVolumes.push(mount.source);
  }
  if (name === 'sandbox') {
    addDisk('sandbox-credentials', SANDBOX_INCUS_MOUNT_POINT, true);
    runtimeVolumes.push('sandbox-credentials');
    for (const file of ['client.crt', 'client.key', 'server.crt'])
      files.push({
        volume: 'sandbox-credentials',
        path: file,
        mode: 0o600,
        source: { kind: 'sandbox-credentials', file },
      });
  }
  const mountPaths = Object.values(devices).map((device) => device.path ?? '');
  for (const path of facts.volumes) {
    const normalised = path.replace(/\/+$/, '') || '/';
    if (
      !mountPaths.some(
        (mount) => normalised === mount || normalised.startsWith(`${mount}/`),
      )
    )
      refuse(
        refusal(
          'image-volume-uncovered',
          `The image declares the volume ${path}.`,
        ),
        'volumes',
      );
  }
  if (!init && Object.keys(devices).length > 0 && !row.acceptedWithoutInit)
    refuse(
      refusal(
        'init-missing',
        `The image ${facts.reference} lacks ${TALE_INIT_LABEL}=${PATCHED_INIT} and the service mounts ${Object.keys(devices).join(', ')}.`,
      ),
      'image',
    );
  return { devices, dataVolumes, runtimeVolumes, files };
}

/** limits.*, linux.sysctl.* and the db image's TALE_SHM_SIZE (into
 * `environment`), each from its compose key, else the placement row, else
 * the profile (R3-12). */
function limitsConfig(
  service: Record<string, unknown>,
  row: PlacementRow,
  environment: Record<string, string>,
  { refuse }: Report,
): Record<string, string> {
  const config: Record<string, string> = {};
  const memory =
    service.mem_limit === undefined ? null : parseSize(service.mem_limit);
  if (service.mem_limit !== undefined && memory === null)
    refuse(
      refusal('size', `"${String(service.mem_limit)}" is no size.`),
      'mem_limit',
    );
  const rowLimits = (row as PlacementRow).limits ?? {};
  config['limits.memory'] =
    memory !== null
      ? incusSize(memory)
      : (rowLimits.memory ?? PROFILE_LIMITS.memory);
  const pids = service.pids_limit;
  if (
    pids !== undefined &&
    (typeof pids !== 'number' || !Number.isInteger(pids) || pids < 1)
  )
    refuse(
      refusal('size', `"${String(pids)}" is no process count.`),
      'pids_limit',
    );
  config['limits.processes'] = String(
    typeof pids === 'number' && Number.isInteger(pids) && pids > 0
      ? pids
      : (rowLimits.processes ?? PROFILE_LIMITS.processes),
  );
  for (const [limit, value] of Object.entries(
    (service.ulimits as Record<string, unknown> | undefined) ?? {},
  )) {
    const pair =
      typeof value === 'number'
        ? `${value}`
        : value !== null &&
            typeof value === 'object' &&
            typeof (value as { soft?: unknown }).soft === 'number' &&
            typeof (value as { hard?: unknown }).hard === 'number'
          ? `${(value as { soft: number }).soft}:${(value as { hard: number }).hard}`
          : null;
    if (!KERNEL_LIMITS.has(limit) || pair === null)
      refuse(
        refusal('ulimit', `"${limit}" is no kernel limit Incus sets.`),
        'ulimits',
      );
    else config[`limits.kernel.${limit}`] = pair;
  }
  const sysctls = sysctlEntries(service.sysctls);
  if (sysctls === null)
    refuse(
      refusal(
        'no-rule',
        'The sysctls are neither a mapping nor a list of key=value.',
      ),
      'sysctls',
    );
  for (const [key, value] of sysctls ?? [])
    config[`linux.sysctl.${key}`] = value;
  if (service.shm_size !== undefined) {
    const bytes = parseSize(service.shm_size);
    if (bytes === null)
      refuse(
        refusal('size', `"${String(service.shm_size)}" is no size.`),
        'shm_size',
      );
    else environment.TALE_SHM_SIZE = shmSize(bytes);
  }
  return config;
}

/** The proxy's published ports, kept for the ingress; the publishes Tale's
 * own sources make that the stack replaces by address are dropped with their
 * reason (R-12); anything else is refused. */
function publishedPorts(
  name: string,
  service: Record<string, unknown>,
  { refuse, ignored }: Report,
): { host: number; container: number }[] {
  const ingressPorts: { host: number; container: number }[] = [];
  const entries = stringList(service.ports);
  if (entries === null)
    refuse(
      refusal('port', 'The port list holds an entry in the long syntax.'),
      'ports',
    );
  for (const entry of entries ?? []) {
    const match = /^(?:(\d{1,3}(?:\.\d{1,3}){3}):)?(\d+):(\d+)(?:\/tcp)?$/.exec(
      entry,
    );
    const hostAddress = match?.[1];
    const hostPort = Number(match?.[2]);
    const containerPort = Number(match?.[3]);
    if (
      name === 'proxy' &&
      match &&
      hostAddress === undefined &&
      (containerPort === 80 || containerPort === 443)
    ) {
      ingressPorts.push({ host: hostPort, container: containerPort });
      continue;
    }
    if (
      (name === 'db' || name === 'knowledge-db') &&
      match &&
      hostAddress === '127.0.0.1' &&
      containerPort === 5432
    ) {
      ignored.push({
        key: 'ports',
        reason: `${entry}: nothing on the node dials the loopback publish, and the CLI reaches Postgres by exec`,
      });
      continue;
    }
    if (
      ((name === 'backend-api' && containerPort === 3005) ||
        (name === 'sandbox-llm-gateway' && containerPort === 8080)) &&
      match &&
      hostAddress !== undefined &&
      hostPort === containerPort
    ) {
      ignored.push({
        key: 'ports',
        reason: `${entry}: the sessions reach the service at its address in the plan`,
      });
      continue;
    }
    refuse(refusal('port', `"${entry}" publishes a port.`), 'ports');
  }
  return ingressPorts;
}

/**
 * The environment the image's own config declares (its `Env`), which Docker
 * puts under a container's environment. The instance carries it itself:
 * Incus fingerprints an OCI image by its layers alone, so two images with the
 * same layers and another config (a release rebuilt with a new `VERSION`, its
 * `TALE_VERSION` in the config alone) are one Incus image, and the config
 * Incus applies is the one of whichever was pulled first. An entry with no
 * `=` names no value and is left out, as Docker leaves it out.
 */
function imageEnvironment(
  env: readonly string[],
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const entry of env) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    environment[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return environment;
}

/**
 * The environment Docker Compose hands a service's container: the keys of its
 * env files, read with Compose's grammar against the interpolation source,
 * under its interpolated `environment` (a key without a value takes the
 * source's value, or is left out). `service` is already interpolated.
 */
export function serviceEnvironment(
  service: Record<string, unknown>,
  variables: Readonly<Record<string, string>>,
  envFiles: Readonly<Record<string, string>>,
): { environment: Record<string, string>; refusals: Refusal[] } {
  const refusals: Refusal[] = [];
  const environment: Record<string, string> = {};
  const entries = envFileEntries(service.env_file ?? []);
  if (entries === null)
    refusals.push(
      refusal(
        'env-file',
        'The env_file list has an entry that is no path.',
        null,
        'env_file',
      ),
    );
  for (const entry of entries ?? []) {
    if (entry.path !== DOTENV_FILE) {
      refusals.push(
        refusal(
          'env-file',
          `"${entry.path}" is no .env file of the deployment.`,
          null,
          'env_file',
        ),
      );
      continue;
    }
    const text = envFiles[entry.path];
    if (text === undefined) {
      if (entry.required)
        refusals.push(
          refusal(
            'env-file',
            `${entry.path} is required and absent.`,
            null,
            'env_file',
          ),
        );
      continue;
    }
    try {
      Object.assign(environment, parseDotenv(text, lookupIn(variables)));
    } catch (error) {
      if (!(error instanceof RefusalError)) throw error;
      refusals.push({ ...error.refusal, key: 'env_file' });
    }
  }
  const declared = environmentEntries(service.environment);
  if (declared === null)
    refusals.push(
      refusal(
        'no-rule',
        'The environment is neither a mapping nor a list.',
        null,
        'environment',
      ),
    );
  for (const [key, value] of declared ?? []) {
    if (value !== null) environment[key] = value;
    else if (Object.hasOwn(variables, key))
      environment[key] = variables[key] ?? '';
  }
  return { environment, refusals };
}

/**
 * Translate one interpolated-on-the-way compose service. Returns the service's
 * instances and what they need, or the refusals it raised (every one, not the
 * first).
 */
export function translateService(
  name: string,
  raw: Record<string, unknown>,
  colour: DeploymentColor | null,
  context: ServiceContext,
): { result: TranslatedService | null; refusals: Refusal[] } {
  const refusals: Refusal[] = [];
  const refuse = (item: Refusal, key: string | null = item.key): void => {
    refusals.push({ ...item, service: name, key });
  };
  const ignored: { key: string; reason: string }[] = [];
  const report: Report = { refuse, ignored };

  for (const key of Object.keys(raw)) {
    const rule = ruleOf(key);
    if (rule === undefined)
      refuse(
        refusal('no-rule', `"${key}" has no rule in the translator's table.`),
        key,
      );
    else if (rule.action === 'refuse')
      refuse(refusal('refused-key', `"${key}" is set; ${rule.rule}.`), key);
    else if (rule.action === 'ignore') ignored.push({ key, reason: rule.rule });
  }

  const row = placementOf(name);
  if (row === undefined || row.kind !== 'service') {
    refuse(
      refusal('placement', `"${name}" has no row in the placement table.`),
      null,
    );
    return { result: null, refusals };
  }

  let service: Record<string, unknown>;
  try {
    service = interpolateDeep(raw, lookupIn(context.variables));
  } catch (error) {
    if (!(error instanceof RefusalError)) throw error;
    refuse(error.refusal, null);
    return { result: null, refusals };
  }

  const imageReference = typeof service.image === 'string' ? service.image : '';
  const facts = context.images[imageReference];
  if (facts === undefined) {
    refuse(
      refusal(
        'image-facts-missing',
        `No image facts were read for "${imageReference}".`,
      ),
      'image',
    );
    return { result: null, refusals };
  }

  // Environment first: D-36 reads the backend's object store endpoint.
  const assembled = serviceEnvironment(
    service,
    context.variables,
    context.envFiles,
  );
  for (const item of assembled.refusals) refuse(item);
  const environment = {
    ...imageEnvironment(facts.env),
    ...assembled.environment,
  };

  // platform: Incus does not emulate.
  const platform = service.platform;
  if (
    typeof platform === 'string' &&
    platform !== `linux/${context.architecture}`
  ) {
    const external =
      (context.variables.OBJECT_STORE_ENDPOINT ??
        BUNDLED_OBJECT_STORE_ENDPOINT) !== BUNDLED_OBJECT_STORE_ENDPOINT;
    if (name === 'object-store' && external)
      return {
        result: {
          service: name,
          instances: [],
          dataVolumes: [],
          runtimeVolumes: [],
          files: [],
          names: {},
          ingressPorts: [],
          ignored,
          image: null,
          omitted: `the image exists only for ${platform} and OBJECT_STORE_ENDPOINT names an external store`,
        },
        refusals,
      };
    refuse(
      name === 'object-store'
        ? refusal(
            'object-store-architecture',
            `The server is ${context.architecture}.`,
          )
        : refusal(
            'platform-mismatch',
            `The service asks for ${platform}; the server is linux/${context.architecture}.`,
          ),
      'platform',
    );
  }

  const alias = imageAlias(facts);
  const init = facts.init === PATCHED_INIT;
  const { devices, dataVolumes, runtimeVolumes, files } = mountsOf(
    name,
    service,
    facts,
    row,
    context,
    report,
  );

  // Stop contract and entrypoint.
  const signal =
    service.stop_signal !== undefined
      ? signalNumber(service.stop_signal)
      : facts.stopSignal !== null
        ? signalNumber(facts.stopSignal)
        : DEFAULT_STOP_SIGNAL;
  if (signal === null)
    refuse(
      refusal(
        'signal',
        `"${String(service.stop_signal ?? facts.stopSignal)}" is no signal Incus can deliver.`,
      ),
      'stop_signal',
    );
  let graceSeconds = DEFAULT_GRACE_SECONDS;
  if (service.stop_grace_period !== undefined) {
    const ms = parseDuration(service.stop_grace_period);
    if (ms === null)
      refuse(
        refusal(
          'duration',
          `"${String(service.stop_grace_period)}" is no duration.`,
        ),
        'stop_grace_period',
      );
    else graceSeconds = Math.ceil(ms / 1000);
  }
  const words = commandWords(service, facts);
  let entrypoint: string | null = null;
  if (!Array.isArray(words)) refuse(words);
  else {
    entrypoint = ociEntrypoint(words, signal ?? DEFAULT_STOP_SIGNAL, init);
    if (entrypoint === null)
      refuse(
        refusal(
          'entrypoint-words',
          'A word of the command holds a NUL or a line break.',
        ),
        'command',
      );
  }

  // Health.
  const health = healthcheckOf(service.healthcheck);
  if (typeof health === 'string')
    refuse(
      refusal(
        'healthcheck-missing',
        health === 'missing'
          ? 'The service declares no healthcheck.'
          : `The healthcheck ${health}.`,
      ),
      'healthcheck',
    );

  const config = limitsConfig(service, row, environment, report);
  const capabilities = stringList(service.cap_add);
  if (capabilities === null)
    refuse(
      refusal('capability', 'cap_add is no list of capability names.'),
      'cap_add',
    );
  for (const capability of capabilities ?? [])
    if (!NAMESPACED_CAPABILITIES.has(capability.replace(/^CAP_/, '')))
      refuse(
        refusal(
          'capability',
          `${capability} is beyond what the user namespace grants.`,
        ),
        'cap_add',
      );

  // Restart.
  const restart = service.restart ?? 'no';
  if (typeof restart !== 'string' || !RESTART_POLICIES.test(restart))
    refuse(
      refusal('restart', `"${String(restart)}" is no restart policy.`),
      'restart',
    );

  // Networks, aliases, extra hosts.
  const networks = networkAliases(service.networks);
  if (networks === null)
    refuse(
      refusal('network', 'The networks are neither a list nor a mapping.'),
      'networks',
    );
  for (const network of networks?.networks ?? [])
    if (!STACK_NETWORKS.has(network))
      refuse(
        refusal('network', `"${network}" is no network of the stack.`),
        'networks',
      );
  const extraNames: Record<string, string> = {};
  const hostEntries = stringList(service.extra_hosts);
  if (hostEntries === null)
    refuse(
      refusal('extra-host', 'extra_hosts is no list of name:address entries.'),
      'extra_hosts',
    );
  for (const entry of hostEntries ?? []) {
    const match = /^([^:=\s]+)[:=](.+)$/.exec(entry);
    const host = match?.[1] ?? '';
    const target = match?.[2] ?? '';
    const address =
      target === 'host-gateway'
        ? context.plan.gateway
        : isUnicastIpv4(target)
          ? target
          : null;
    if (address === null || !DNS_NAME.test(host))
      refuse(
        refusal(
          'extra-host',
          `"${entry}" maps no name to the gateway or an IPv4 address.`,
        ),
        'extra_hosts',
      );
    else extraNames[host] = address;
  }

  const ingressPorts = publishedPorts(name, service, report);

  const dependsOn = dependencies(service.depends_on);
  if (dependsOn === null)
    refuse(
      refusal('depends-on', 'depends_on is neither a list nor a mapping.'),
      'depends_on',
    );

  // The spawner always runs in the Incus shape on this runtime.
  if (name === 'sandbox') {
    for (const variable of SANDBOX_DOCKER_ONLY_VARIABLES)
      delete environment[variable];
    if (context.sandboxRuntime === undefined)
      refuse(
        refusal(
          'image-facts-missing',
          'No image facts were read for tale-sandbox-runtime, the image of the sessions.',
        ),
        'environment',
      );
    else {
      const image = incusImage(context.sandboxRuntime);
      Object.assign(
        environment,
        incusSandboxVariables({
          ...image,
          source: mirroredSource(image.source, context.mirrors),
        }),
      );
    }
    environment[EGRESS_PROXY_VARIABLE] =
      context.egressProxy ??
      `http://${context.plan.singleton('sandbox-egress')}:3128`;
    environment.SANDBOX_INCUS_DNS = context.plan.singleton('names-sessions');
    environment.SANDBOX_INCUS_ENDPOINT = context.endpoint;
    // The zone `tale incus bootstrap` made, unless `.env` names another.
    for (const [variable, value] of Object.entries(context.sessionsZone ?? {}))
      environment[variable] ??= value;
  }

  if (refusals.length > 0) return { result: null, refusals };

  const address = row.address as { singleton?: string; slot?: string };
  const slotRole = address.slot as
    | keyof typeof SWITCHED_ROLES
    | 'backend-worker'
    | undefined;
  const replicaCount =
    slotRole === undefined ? 1 : (context.replicas[slotRole] ?? 1);
  const instances: InstanceSpec[] = [];
  const names: Record<string, string[]> = {};
  const add = (record: string, value: string): void => {
    (names[record] ??= []).push(value);
  };
  for (let index = 1; index <= replicaCount; index += 1) {
    const instanceAddress =
      slotRole === undefined
        ? context.plan.singleton(
            name as Parameters<AddressPlan['singleton']>[0],
          )
        : context.plan.slot(slotRole, colour ?? 'blue', index);
    const instanceName =
      slotRole === undefined
        ? name
        : colour === null
          ? `${name}-${index}`
          : `${name}-${colour}-${index}`;
    const instanceConfig: Record<string, string> = {
      ...config,
      'oci.entrypoint': entrypoint ?? '',
      'oci.dns.nameservers': context.plan.singleton('names'),
      'boot.autorestart': restart === 'no' ? 'false' : 'true',
      'boot.autostart.priority': String(row.start),
      'boot.stop.priority': String(row.stop),
      'security.idmap.isolated': 'true',
      'security.guestapi': 'false',
      ...Object.fromEntries(
        Object.entries(environment)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [`environment.${key}`, value]),
      ),
      ...taleLabels({
        stack: context.stack,
        service: name,
        role: name,
        index: slotRole === undefined ? null : index,
        colour: slotRole === undefined ? null : colour,
        facts,
        graceSeconds,
        signal: signal ?? DEFAULT_STOP_SIGNAL,
      }),
    };
    instances.push({
      name: instanceName,
      service: name,
      index: slotRole === undefined ? null : index,
      colour: slotRole === undefined ? null : colour,
      image: alias,
      address: instanceAddress,
      config: sortKeys(instanceConfig),
      devices: {
        ...devices,
        eth0: nicDevice(context, instanceAddress),
        ...(name === 'proxy' && context.ingress.mode === 'proxy-device'
          ? proxyDevices(context, instanceAddress, ingressPorts)
          : {}),
      },
      healthcheck: health as Healthcheck | { disabled: true },
      stop: { signal: signal ?? DEFAULT_STOP_SIGNAL, graceSeconds },
      dependsOn: dependsOn ?? [],
    });
    // Names: the service, and every alias it asks for. The switch holds the
    // stable names of the switched roles, so their replicas add only their
    // colour's names.
    const switched = Object.hasOwn(SWITCHED_ROLES, name);
    if (!switched) add(name, instanceAddress);
    for (const aliasName of networks?.aliases ?? [])
      if (!(switched && aliasName === name)) add(aliasName, instanceAddress);
  }
  for (const [host, value] of Object.entries(extraNames)) names[host] = [value];
  if (
    name === 'proxy' &&
    context.ingress.mode === 'routed' &&
    ingressPorts.length > 0
  )
    ignored.push({
      key: 'ports',
      reason:
        'the routed ingress publishes nothing: the operator forwards to the proxy',
    });

  return {
    result: {
      service: name,
      instances,
      dataVolumes,
      runtimeVolumes,
      files,
      names,
      ingressPorts,
      ignored,
      image: { alias, facts },
    },
    refusals,
  };
}

export function nicDevice(
  context: Pick<ServiceContext, 'bridge' | 'plan'>,
  address: string,
): Record<string, string> {
  // The CIDR form with a gateway runs no DHCP client in the instance and
  // writes no search domain (design D-14, R-03, R3-09).
  return {
    type: 'nic',
    network: context.bridge,
    name: 'eth0',
    'ipv4.address': `${address}/${context.plan.subnetPrefix}`,
    'ipv4.gateway': context.plan.gateway,
    'ipv6.address': 'none',
  };
}

function proxyDevices(
  context: Pick<ServiceContext, 'ingress'>,
  address: string,
  ports: { host: number; container: number }[],
): Devices {
  // NAT proxy devices keep the client address (design D-19).
  return Object.fromEntries(
    ports.map(({ host, container }) => [
      `ingress-${container}`,
      {
        type: 'proxy',
        listen: `tcp:${context.ingress.listen ?? '0.0.0.0'}:${host}`,
        connect: `tcp:${address}:${container}`,
        nat: 'true',
      },
    ]),
  );
}

export function taleLabels(options: {
  stack: string;
  service: string;
  role: string;
  index: number | null;
  colour: DeploymentColor | null;
  facts: ImageFacts;
  graceSeconds: number;
  signal: number;
}): Record<string, string> {
  const version = options.facts.labels['org.opencontainers.image.version'];
  return {
    'user.tale.stack': options.stack,
    'user.tale.service': options.service,
    'user.tale.role': options.role,
    ...(options.index === null
      ? {}
      : { 'user.tale.index': String(options.index) }),
    ...(options.colour === null ? {} : { 'user.tale.colour': options.colour }),
    'user.tale.image': options.facts.digest,
    ...(version === undefined ? {} : { 'user.tale.version': version }),
    ...(options.facts.revision === null
      ? {}
      : { 'user.tale.revision': options.facts.revision }),
    'user.tale.grace': String(options.graceSeconds),
    'user.tale.signal': String(options.signal),
  };
}

export function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}

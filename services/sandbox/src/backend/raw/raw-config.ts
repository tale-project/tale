// The raw backend's settings: `SANDBOX_RAW`, one JSON object the device's
// launcher (`tale sandbox device run`, tools/cli) hands the spawner. See
// docs/raw.md.

/** How a raw device keeps its sessions apart. */
export type RawIsolation = 'isolated' | 'shared';

/** One account a session of an isolated device runs as. */
export interface RawSlot {
  /** The account's name (`tale-slot-01`). */
  user: string;
  uid: number;
  gid: number;
  /** The account's home directory as the system records it: emptied when the
   * slot is handed back, since a program that asks the system rather than
   * `$HOME` writes there. */
  home: string;
}

export interface RawConfig {
  /** Everything the device keeps: `sessions/`, `control/`, `logs/`, the
   * trash. A plain absolute path the session view may carry verbatim. */
  root: string;
  isolation: RawIsolation;
  /** The accounts of an isolated device, one running session each; empty
   * when shared. */
  slots: RawSlot[];
  /** How runnerd starts: the program and its arguments (the device's `tale`
   * binary and the runnerd bundle it extracted). */
  runnerd: string[];
  /** Variables runnerd itself starts with (`BUN_BE_BUN=1`); never passed on
   * to what it runs. */
  runnerdEnv: Record<string, string>;
  /** The directory of the runtime's helper programs (`tale-plan-gate`, …),
   * first on every session's PATH. */
  bin: string;
  /** The rest of a session's PATH, in order: where the harnesses are
   * installed, then the system's. */
  path: string[];
  /** Claude Code's settings a session starts with (the hooks the image's
   * managed settings name), or null where none ships. */
  claudeSettings: string | null;
}

export class RawConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RawConfigError';
  }
}

/** A path a session's view carries verbatim (session-view.ts in runnerd):
 * no space, quote, backslash or control character. */
const PLAIN_PATH = /^\/[A-Za-z0-9._~/+@%-]*$/;
const ACCOUNT_NAME = /^[a-z_][a-z0-9_-]{0,31}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

function record(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RawConfigError(`SANDBOX_RAW: ${what} must be an object`);
  }
  return Object.fromEntries(Object.entries(value));
}

function absolute(value: unknown, what: string, plain = false): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.length > 1024
  ) {
    throw new RawConfigError(`SANDBOX_RAW: ${what} must be an absolute path`);
  }
  if (
    plain &&
    (!PLAIN_PATH.test(value) || value.endsWith('/') || value === '/')
  ) {
    throw new RawConfigError(
      `SANDBOX_RAW: ${what} must be a plain directory path (letters, digits and ._~+@%- only, no trailing slash): ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function id(value: unknown, what: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > 4_294_967_294
  ) {
    throw new RawConfigError(
      `SANDBOX_RAW: ${what} must be a positive integer (never root's 0)`,
    );
  }
  return value;
}

export function parseRawConfig(raw: string | undefined): RawConfig {
  if (raw === undefined || raw.trim() === '') {
    throw new RawConfigError(
      'SANDBOX_BACKEND=raw needs SANDBOX_RAW (the device launcher `tale sandbox device run` sets it)',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RawConfigError('SANDBOX_RAW is not JSON');
  }
  const input = record(parsed, 'the value');
  const isolation = input.isolation;
  if (isolation !== 'isolated' && isolation !== 'shared') {
    throw new RawConfigError(
      `SANDBOX_RAW: isolation must be 'isolated' or 'shared', not ${JSON.stringify(isolation)}`,
    );
  }
  const rawSlots = input.slots ?? [];
  if (!Array.isArray(rawSlots) || rawSlots.length > 256) {
    throw new RawConfigError(
      'SANDBOX_RAW: slots must be a list of at most 256',
    );
  }
  const slots = rawSlots.map((entry, index): RawSlot => {
    const slot = record(entry, `slots[${index}]`);
    if (typeof slot.user !== 'string' || !ACCOUNT_NAME.test(slot.user)) {
      throw new RawConfigError(
        `SANDBOX_RAW: slots[${index}].user must be an account name`,
      );
    }
    return {
      user: slot.user,
      uid: id(slot.uid, `slots[${index}].uid`),
      gid: id(slot.gid, `slots[${index}].gid`),
      home: absolute(slot.home, `slots[${index}].home`),
    };
  });
  if (isolation === 'isolated' && slots.length === 0) {
    throw new RawConfigError(
      'SANDBOX_RAW: an isolated device needs at least one slot account',
    );
  }
  if (isolation === 'shared' && slots.length > 0) {
    throw new RawConfigError(
      'SANDBOX_RAW: a shared device runs its sessions as its own account and names no slots',
    );
  }
  for (const key of ['user', 'uid'] as const) {
    const seen = new Set(slots.map((slot) => slot[key]));
    if (seen.size !== slots.length) {
      throw new RawConfigError(`SANDBOX_RAW: two slots share a ${key}`);
    }
  }
  const runnerd = input.runnerd;
  if (
    !Array.isArray(runnerd) ||
    runnerd.length === 0 ||
    runnerd.length > 16 ||
    !runnerd.every((part): part is string => typeof part === 'string')
  ) {
    throw new RawConfigError(
      'SANDBOX_RAW: runnerd must be the program and its arguments',
    );
  }
  absolute(runnerd[0], 'runnerd[0]');
  const runnerdEnv: Record<string, string> = {};
  for (const [name, value] of Object.entries(
    record(input.runnerdEnv ?? {}, 'runnerdEnv'),
  )) {
    if (!ENV_NAME.test(name) || typeof value !== 'string') {
      throw new RawConfigError(
        `SANDBOX_RAW: runnerdEnv.${name} must be a string variable`,
      );
    }
    runnerdEnv[name] = value;
  }
  const path = input.path ?? [];
  if (
    !Array.isArray(path) ||
    path.length > 64 ||
    !path.every((entry): entry is string => typeof entry === 'string')
  ) {
    throw new RawConfigError('SANDBOX_RAW: path must be a list of directories');
  }
  for (const [index, entry] of path.entries()) {
    absolute(entry, `path[${index}]`);
    if (entry.includes(':')) {
      throw new RawConfigError(`SANDBOX_RAW: path[${index}] holds a ':'`);
    }
  }
  const claudeSettings =
    input.claudeSettings === undefined || input.claudeSettings === null
      ? null
      : absolute(input.claudeSettings, 'claudeSettings');
  return {
    root: absolute(input.root, 'root', true),
    isolation,
    slots,
    runnerd,
    runnerdEnv,
    bin: absolute(input.bin, 'bin'),
    path,
    claudeSettings,
  };
}

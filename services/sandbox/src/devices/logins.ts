// A device's own sign-ins: a harness login that lives on the device and never
// leaves it (docs/devices.md#sign-ins). `tale sandbox login <harness>` stores
// one in `<stateDir>/logins/<harness>.json`, readable by the device's account
// alone; the device reports which harnesses it holds one for (never the
// secret), and a turn the platform starts on the device's sign-in carries a
// sentinel where the secret goes, which the device swaps for its own copy as
// the exec passes through it. A platform that names the sentinel anywhere
// else gets the sentinel: the swap is limited to the one variable each
// harness reads its sign-in from.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The harnesses a device can hold a sign-in for, and the variable each one
 * reads it from: Claude Code takes the long-lived token `claude setup-token`
 * prints. */
export const DEVICE_LOGIN_HARNESSES: Readonly<Record<string, { env: string }>> =
  {
    'claude-code': { env: 'CLAUDE_CODE_OAUTH_TOKEN' },
  };

/** What the platform sends where a device's sign-in goes. */
export const DEVICE_LOGIN_SENTINEL_PREFIX = 'tale-device-login:';

export function deviceLoginSentinel(harness: string): string {
  return `${DEVICE_LOGIN_SENTINEL_PREFIX}${harness}`;
}

/** A sign-in as the device reports it: which harness, since when. */
export interface DeviceLoginReport {
  harness: string;
  addedAtMs: number;
}

interface StoredLogin {
  harness: string;
  token: string;
  addedAtMs: number;
}

const TOKEN = /^[\x21-\x7e]{16,4096}$/;

function parseStored(text: string, harness: string): StoredLogin | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object') return null;
  const token: unknown = Reflect.get(value, 'token');
  const addedAtMs: unknown = Reflect.get(value, 'addedAtMs');
  if (
    Reflect.get(value, 'harness') !== harness ||
    typeof token !== 'string' ||
    !TOKEN.test(token) ||
    typeof addedAtMs !== 'number' ||
    !Number.isFinite(addedAtMs)
  ) {
    return null;
  }
  return { harness, token, addedAtMs };
}

/** The sign-ins in a device's directory, read when asked: a login added or
 * removed while the device runs is reported with its next status. */
export class DeviceLogins {
  constructor(private readonly dir: string) {}

  private async read(harness: string): Promise<StoredLogin | null> {
    if (DEVICE_LOGIN_HARNESSES[harness] === undefined) return null;
    let text: string;
    try {
      text = await readFile(join(this.dir, `${harness}.json`), 'utf8');
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
    const stored = parseStored(text, harness);
    if (stored === null) {
      console.warn(
        `[sandbox.devices] ${join(this.dir, `${harness}.json`)} is no sign-in this device can use; reporting none`,
      );
    }
    return stored;
  }

  /** The harnesses this device holds a sign-in for. */
  async list(): Promise<DeviceLoginReport[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }
    const out: DeviceLoginReport[] = [];
    for (const harness of Object.keys(DEVICE_LOGIN_HARNESSES).sort()) {
      if (!names.includes(`${harness}.json`)) continue;
      const stored = await this.read(harness);
      if (stored !== null) {
        out.push({ harness, addedAtMs: stored.addedAtMs });
      }
    }
    return out;
  }

  async token(harness: string): Promise<string | null> {
    return (await this.read(harness))?.token ?? null;
  }
}

/**
 * An exec request body with the device's sign-ins in place of their
 * sentinels: only in the variable each harness reads its sign-in from, and
 * only for a sign-in this device holds. A body that names no sentinel, or is
 * no exec request, passes as it is.
 */
export async function withDeviceLogins(
  body: string,
  logins: Pick<DeviceLogins, 'token'>,
): Promise<string> {
  if (!body.includes(DEVICE_LOGIN_SENTINEL_PREFIX)) return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (parsed === null || typeof parsed !== 'object') return body;
  const env: unknown = Reflect.get(parsed, 'env');
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    return body;
  }
  const next: Record<string, unknown> = { ...env };
  let swapped = false;
  for (const [harness, { env: name }] of Object.entries(
    DEVICE_LOGIN_HARNESSES,
  )) {
    if (next[name] !== deviceLoginSentinel(harness)) continue;
    const token = await logins.token(harness);
    if (token === null) {
      console.warn(
        `[sandbox.devices] a turn asked for this device's ${harness} sign-in, which it does not hold`,
      );
      continue;
    }
    next[name] = token;
    swapped = true;
  }
  if (!swapped) return body;
  return JSON.stringify({ ...parsed, env: next });
}

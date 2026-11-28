import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A sandbox device's own sign-ins (`tale sandbox login`): a harness login
 * that stays on the machine. The device reports that it holds one, never
 * the secret, and swaps it into the turns the platform starts on it — the
 * shape `services/sandbox/src/devices/logins.ts` reads (both suites pin one
 * example). One file per harness in `<device home>/logins/`, the owner's
 * alone (0600 in a 0700 directory): on an isolated raw device that is root,
 * and no sandbox's account can read it.
 */

/** The harnesses a device can hold a sign-in for, and how to get one. */
export const DEVICE_LOGIN_HARNESSES: Readonly<
  Record<string, { name: string; how: string }>
> = {
  'claude-code': {
    name: 'Claude Code',
    how: 'Run `claude setup-token` with a Claude Pro, Max, Team or Enterprise account; it prints a token that lasts a year.',
  },
};

const TOKEN = /^[\x21-\x7e]{16,4096}$/;

export interface DeviceLogin {
  harness: string;
  addedAtMs: number;
}

export function loginsDir(home: string): string {
  return join(home, 'logins');
}

export function isLoginHarness(harness: string): boolean {
  return DEVICE_LOGIN_HARNESSES[harness] !== undefined;
}

/** Store a sign-in, replacing the one the harness had. */
export async function saveDeviceLogin(
  home: string,
  harness: string,
  token: string,
  now: number = Date.now(),
): Promise<void> {
  if (!isLoginHarness(harness)) {
    throw new Error(`a device holds no ${harness} sign-in`);
  }
  const value = token.trim();
  if (!TOKEN.test(value)) {
    throw new Error(
      'that is no sign-in token (one line of printable characters, no spaces)',
    );
  }
  const dir = loginsDir(home);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const path = join(dir, `${harness}.json`);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify({ harness, token: value, addedAtMs: now })}\n`,
    { mode: 0o600 },
  );
  await rename(temporary, path);
}

export async function removeDeviceLogin(
  home: string,
  harness: string,
): Promise<boolean> {
  const path = join(loginsDir(home), `${harness}.json`);
  try {
    await readFile(path);
  } catch {
    return false;
  }
  await rm(path, { force: true });
  return true;
}

/** The sign-ins a device holds (never their secrets). */
export async function listDeviceLogins(home: string): Promise<DeviceLogin[]> {
  let names: string[];
  try {
    names = await readdir(loginsDir(home));
  } catch {
    return [];
  }
  const out: DeviceLogin[] = [];
  for (const harness of Object.keys(DEVICE_LOGIN_HARNESSES).sort()) {
    if (!names.includes(`${harness}.json`)) continue;
    try {
      const value: unknown = JSON.parse(
        await readFile(join(loginsDir(home), `${harness}.json`), 'utf8'),
      );
      const addedAtMs =
        value !== null && typeof value === 'object'
          ? Reflect.get(value, 'addedAtMs')
          : undefined;
      if (typeof addedAtMs === 'number') out.push({ harness, addedAtMs });
    } catch (err) {
      console.warn(`[tale] unreadable sign-in for ${harness}:`, err);
    }
  }
  return out;
}

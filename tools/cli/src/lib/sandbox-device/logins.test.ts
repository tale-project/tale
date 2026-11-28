import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  listDeviceLogins,
  loginsDir,
  removeDeviceLogin,
  saveDeviceLogin,
} from './logins';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

const TOKEN = `sk-ant-oat01-${'x'.repeat(40)}`;

// A sandbox device runs on Linux or macOS, and a sign-in is the owner's alone
// by its POSIX modes.
const describePosix = describe.skipIf(process.platform === 'win32');

describePosix('device sign-ins', () => {
  test('are stored owner-only, in the shape the device reads', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tale-cli-logins-'));
    dirs.push(home);
    await saveDeviceLogin(home, 'claude-code', `${TOKEN}\n`, 1700);
    const path = join(loginsDir(home), 'claude-code.json');
    // services/sandbox/src/devices/logins.test.ts reads this very shape.
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      harness: 'claude-code',
      token: TOKEN,
      addedAtMs: 1700,
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(loginsDir(home))).mode & 0o777).toBe(0o700);
    expect(await listDeviceLogins(home)).toEqual([
      { harness: 'claude-code', addedAtMs: 1700 },
    ]);
    expect(await removeDeviceLogin(home, 'claude-code')).toBe(true);
    expect(await listDeviceLogins(home)).toEqual([]);
    expect(await removeDeviceLogin(home, 'claude-code')).toBe(false);
  });

  test('refuse a harness without device sign-ins, and a token that is no token', async () => {
    const home = await mkdtemp(join(tmpdir(), 'tale-cli-logins-'));
    dirs.push(home);
    await expect(saveDeviceLogin(home, 'codex', TOKEN)).rejects.toThrow(
      /no codex sign-in/,
    );
    await expect(saveDeviceLogin(home, 'claude-code', 'short')).rejects.toThrow(
      /no sign-in token/,
    );
    await expect(
      saveDeviceLogin(home, 'claude-code', 'has a space in it here'),
    ).rejects.toThrow();
  });
});

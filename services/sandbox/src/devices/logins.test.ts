import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DeviceLogins,
  deviceLoginSentinel,
  withDeviceLogins,
} from './logins.ts';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

async function loginsDir(files: Record<string, unknown>): Promise<string> {
  const dir = join(await mkdtemp(join(tmpdir(), 'tale-logins-')), 'logins');
  dirs.push(join(dir, '..'));
  await mkdir(dir, { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    await writeFile(
      join(dir, name),
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  }
  return dir;
}

const TOKEN = `sk-ant-oat01-${'x'.repeat(40)}`;

describe('a device sign-in', () => {
  test('is reported by harness and age, never by its secret', async () => {
    const logins = new DeviceLogins(
      await loginsDir({
        'claude-code.json': {
          harness: 'claude-code',
          token: TOKEN,
          addedAtMs: 1700,
        },
        'codex.json': { harness: 'codex', token: TOKEN, addedAtMs: 1 },
        'notes.txt': 'not a login',
      }),
    );
    expect(await logins.list()).toEqual([
      { harness: 'claude-code', addedAtMs: 1700 },
    ]);
    expect(await logins.token('claude-code')).toBe(TOKEN);
    expect(await logins.token('codex')).toBeNull();
  });

  test('that is malformed or missing reads as none', async () => {
    expect(
      await new DeviceLogins(
        await loginsDir({ 'claude-code.json': '{' }),
      ).list(),
    ).toEqual([]);
    expect(
      await new DeviceLogins(
        await loginsDir({
          'claude-code.json': { harness: 'codex', token: TOKEN, addedAtMs: 1 },
        }),
      ).list(),
    ).toEqual([]);
    expect(await new DeviceLogins('/nonexistent/tale/logins').list()).toEqual(
      [],
    );
  });
});

describe('withDeviceLogins', () => {
  const logins = {
    token: async (harness: string) =>
      harness === 'claude-code' ? TOKEN : null,
  };

  test('swaps the sentinel for the secret in the variable the harness reads', async () => {
    const body = JSON.stringify({
      execId: 'e1',
      command: ['claude', '-p'],
      env: {
        CLAUDE_CODE_OAUTH_TOKEN: deviceLoginSentinel('claude-code'),
        OTHER: 'x',
      },
    });
    const out = JSON.parse(await withDeviceLogins(body, logins));
    expect(out.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN, OTHER: 'x' });
    expect(out.command).toEqual(['claude', '-p']);
  });

  test('leaves the sentinel anywhere else, and a body that names none', async () => {
    const elsewhere = JSON.stringify({
      env: { LEAK: deviceLoginSentinel('claude-code') },
    });
    expect(await withDeviceLogins(elsewhere, logins)).toBe(elsewhere);
    const plain = JSON.stringify({
      env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-real' },
    });
    expect(await withDeviceLogins(plain, logins)).toBe(plain);
    expect(
      await withDeviceLogins('not json tale-device-login:claude-code', logins),
    ).toBe('not json tale-device-login:claude-code');
  });

  test('leaves the sentinel when the device holds no such sign-in', async () => {
    const body = JSON.stringify({
      env: { CLAUDE_CODE_OAUTH_TOKEN: deviceLoginSentinel('claude-code') },
    });
    expect(await withDeviceLogins(body, { token: async () => null })).toBe(
      body,
    );
  });
});

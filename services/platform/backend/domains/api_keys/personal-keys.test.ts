import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import {
  organizationsAdmittingPersonalKeys,
  personalKeysStandingIn,
  personalKeysStandingOf,
} from './personal-keys.ts';

let root: string;

async function storePolicy(slug: string, body: string): Promise<void> {
  const directory = path.join(root, slug, 'governance');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'personal-keys.yml'), body);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'personal-keys-'));
  vi.stubEnv('TALE_CONFIG_DIR', root);
  clearOrgConfigCaches();
});

afterEach(async () => {
  clearOrgConfigCaches();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('personalKeysStandingIn', () => {
  it('admits members’ own keys where the setting was never stored [APIKEY-R12]', async () => {
    await expect(personalKeysStandingIn('acme')).resolves.toBe('admitted');
  });

  it('follows the stored setting, and a change at once [APIKEY-R12]', async () => {
    await storePolicy('acme', 'enabled: true\n');
    await expect(personalKeysStandingIn('acme')).resolves.toBe('admitted');
    await storePolicy('acme', 'enabled: false\n');
    // No cache stands between the switch and the door.
    await expect(personalKeysStandingIn('acme')).resolves.toBe('refused');
    await storePolicy('acme', 'enabled: true\n');
    await expect(personalKeysStandingIn('acme')).resolves.toBe('admitted');
  });

  it('keeps the keys out while the setting cannot be read [APIKEY-R12]', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await storePolicy('acme', 'enabled: "no"\n');
    await expect(personalKeysStandingIn('acme')).resolves.toBe('unavailable');
    await storePolicy('acme', 'enabled: [\n');
    await expect(personalKeysStandingIn('acme')).resolves.toBe('unavailable');
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('acme: the personal keys policy cannot be read'),
      expect.anything(),
    );
  });

  it('keeps the keys out without a config root rather than guessing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('TALE_CONFIG_DIR', '');
    await expect(personalKeysStandingIn('acme')).resolves.toBe('unavailable');
  });

  it('reads one organization alone', async () => {
    await storePolicy('acme', 'enabled: false\n');
    await expect(personalKeysStandingIn('acme')).resolves.toBe('refused');
    await expect(personalKeysStandingIn('globex')).resolves.toBe('admitted');
  });
});

describe('personalKeysStandingOf', () => {
  it('reads the setting of the organization with this id', async () => {
    await storePolicy('acme', 'enabled: false\n');
    const sql = vi.fn(async () => [{ slug: 'acme' }]) as unknown as Sql;
    await expect(personalKeysStandingOf(sql, 'org-acme')).resolves.toBe(
      'refused',
    );
  });

  it('keeps the keys out for an organization it cannot find', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sql = vi.fn(async () => []) as unknown as Sql;
    await expect(personalKeysStandingOf(sql, 'org-gone')).resolves.toBe(
      'unavailable',
    );
  });
});

describe('organizationsAdmittingPersonalKeys', () => {
  it('lists where a refused key still works [APIKEY-R12]', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await storePolicy('refusing', 'enabled: false\n');
    await storePolicy('admitting', 'enabled: true\n');
    await storePolicy('unreadable', 'enabled: 1\n');
    const organizations = [
      { id: 'o1', slug: 'never-stored', name: 'Never stored' },
      { id: 'o2', slug: 'refusing', name: 'Refusing' },
      { id: 'o3', slug: 'admitting', name: 'Admitting' },
      { id: 'o4', slug: 'unreadable', name: 'Unreadable' },
    ];
    await expect(
      organizationsAdmittingPersonalKeys(organizations),
    ).resolves.toEqual([organizations[0], organizations[2]]);
  });
});

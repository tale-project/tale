// @vitest-environment node

import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readDomainConfigFile } from './read_domain_file';

// The mid-migration contract: `.yml` is authoritative wherever it exists,
// `.json` remains readable where it does not, and a broken `.yml` is an
// error — never a silent fall-through to the superseded `.json` sibling.

const MAX_BYTES = 64 * 1024;

interface Config {
  enabled: boolean;
}

function validate(data: unknown): Config {
  if (
    typeof data !== 'object' ||
    data === null ||
    typeof (data as Record<string, unknown>).enabled !== 'boolean'
  ) {
    throw new Error('expected { enabled: boolean }');
  }
  return data as Config;
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'read-domain-file-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('readDomainConfigFile', () => {
  it('reads the .yml when only it exists', async () => {
    await writeFile(path.join(dir, 'policy.yml'), 'enabled: true\n');
    const result = await readDomainConfigFile(
      dir,
      'policy',
      MAX_BYTES,
      validate,
    );
    expect(result).toMatchObject({
      ok: true,
      data: { enabled: true },
      format: 'yaml',
    });
  });

  it('falls back to the .json when the .yml is absent', async () => {
    await writeFile(path.join(dir, 'policy.json'), '{"enabled": false}\n');
    const result = await readDomainConfigFile(
      dir,
      'policy',
      MAX_BYTES,
      validate,
    );
    expect(result).toMatchObject({
      ok: true,
      data: { enabled: false },
      format: 'json',
    });
  });

  it('prefers the .yml over a coexisting .json sibling', async () => {
    await writeFile(path.join(dir, 'policy.yml'), 'enabled: true\n');
    await writeFile(path.join(dir, 'policy.json'), '{"enabled": false}\n');
    const result = await readDomainConfigFile(
      dir,
      'policy',
      MAX_BYTES,
      validate,
    );
    expect(result).toMatchObject({ ok: true, data: { enabled: true } });
  });

  it('reports a corrupt .yml instead of falling back to the .json', async () => {
    await writeFile(path.join(dir, 'policy.yml'), '{ not yaml: [\n');
    await writeFile(path.join(dir, 'policy.json'), '{"enabled": false}\n');
    const result = await readDomainConfigFile(
      dir,
      'policy',
      MAX_BYTES,
      validate,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('corrupted');
      expect(result.message).not.toContain('Invalid JSON');
    }
  });

  it('surfaces a schema violation in the .yml as corrupted', async () => {
    await writeFile(path.join(dir, 'policy.yml'), 'enabled: maybe\n');
    const result = await readDomainConfigFile(
      dir,
      'policy',
      MAX_BYTES,
      validate,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('corrupted');
  });

  it('returns not_found when neither format exists', async () => {
    const result = await readDomainConfigFile(
      dir,
      'policy',
      MAX_BYTES,
      validate,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('not_found');
  });

  it('refuses a symlinked .yml', async () => {
    await writeFile(path.join(dir, 'real.yml'), 'enabled: true\n');
    await symlink(path.join(dir, 'real.yml'), path.join(dir, 'policy.yml'));
    const result = await readDomainConfigFile(
      dir,
      'policy',
      MAX_BYTES,
      validate,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('symlink');
  });

  it('rejects a traversal-shaped file base', async () => {
    await expect(
      readDomainConfigFile(dir, '../escape', MAX_BYTES, validate),
    ).rejects.toThrow(/traversal/i);
  });
});

import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { claimNssTarget } from './browser/nss-trust.ts';

const owned: string[] = [];
afterEach(async () => {
  for (const path of owned.splice(0))
    await rm(path, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tale-nss-lifecycle-'));
  owned.push(root);
  const source = join(root, 'public-source');
  await mkdir(source);
  const expected = [];
  for (const name of ['cert9.db', 'key4.db']) {
    const data = Buffer.from(`synthetic-public-${name}`);
    await writeFile(join(source, name), data);
    expected.push({
      name,
      sha256: createHash('sha256').update(data).digest('hex'),
    });
  }
  return { root, source, expected, target: join(root, '.pki', 'nssdb') };
}

test('an initially absent target accepts fresh public trust when the negative browser creates no database', async () => {
  const f = await fixture();
  const claim = await claimNssTarget(f.target);
  const receipt = await claim.install(f.source, f.expected);
  expect(receipt.priorCreatedByNegativeBrowser).toBe(false);
  expect((await readdir(f.target)).sort()).toEqual(['cert9.db', 'key4.db']);
  expect(receipt.copied.map((file) => file.mode)).toEqual([0o600, 0o600]);
  await expect(claim.install(f.source, f.expected)).rejects.toThrow('consumed');
});
test('preserves NSS files created by the closed negative browser before installing fresh public trust', async () => {
  const f = await fixture();
  const claim = await claimNssTarget(f.target);
  await mkdir(f.target, { recursive: true });
  await writeFile(join(f.target, 'cert9.db'), 'owned-negative-db');
  await writeFile(join(f.target, 'pkcs11.txt'), 'owned-module-config');
  const receipt = await claim.install(f.source, f.expected);
  expect(receipt.priorCreatedByNegativeBrowser).toBe(true);
  expect(
    await readFile(join(receipt.preservedInsideContainer!, 'cert9.db'), 'utf8'),
  ).toBe('owned-negative-db');
  expect(await readFile(join(f.target, 'cert9.db'), 'utf8')).toBe(
    'synthetic-public-cert9.db',
  );
  expect(await readdir(f.target)).not.toContain('pkcs11.txt');
});
test('refuses preexisting NSS state and preserves it byte for byte', async () => {
  const f = await fixture();
  await mkdir(f.target, { recursive: true });
  await writeFile(join(f.target, 'cert9.db'), 'preexisting');
  await expect(claimNssTarget(f.target)).rejects.toThrow('preexisting');
  expect(await readFile(join(f.target, 'cert9.db'), 'utf8')).toBe(
    'preexisting',
  );
});
test('refuses symlinked targets and unexpected files created after the absence claim', async () => {
  for (const kind of ['symlink', 'foreign']) {
    const f = await fixture();
    const claim = await claimNssTarget(f.target);
    await mkdir(join(f.root, '.pki'));
    if (kind === 'symlink') await symlink(f.source, f.target);
    else {
      await mkdir(f.target);
      await writeFile(join(f.target, 'unknown-private-key'), 'must-survive');
    }
    await expect(claim.install(f.source, f.expected)).rejects.toThrow();
    if (kind === 'foreign')
      expect(
        await readFile(join(f.target, 'unknown-private-key'), 'utf8'),
      ).toBe('must-survive');
    expect(await readFile(join(f.source, 'cert9.db'), 'utf8')).toBe(
      'synthetic-public-cert9.db',
    );
  }
});
test('refuses a changed public source before moving any owned negative-browser state', async () => {
  const f = await fixture();
  const claim = await claimNssTarget(f.target);
  await mkdir(f.target, { recursive: true });
  await writeFile(join(f.target, 'cert9.db'), 'keep-owned');
  await writeFile(join(f.source, 'cert9.db'), 'changed');
  await expect(claim.install(f.source, f.expected)).rejects.toThrow('differs');
  expect(await readFile(join(f.target, 'cert9.db'), 'utf8')).toBe('keep-owned');
});

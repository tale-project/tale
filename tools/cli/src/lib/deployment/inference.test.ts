import { afterEach, describe, expect, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sha256 } from '../config/releases/identity';
import {
  INFERENCE_IMAGES,
  prepareManagedInference,
  verifyManagedInference,
} from './inference';
import { managedInferenceFixture } from './inference-test-helper';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const value = await managedInferenceFixture();
  roots.push(value.root);
  return value;
}

describe('managed inference committed-source companion (synthetic Docker)', () => {
  test('binds committed source/env resolution and keeps an empty ready roster explicit503', async () => {
    const f = await fixture();
    // A dirty worktree cannot change the selected model catalog.
    await writeFile(join(f.repo, 'tale/inference/spec.json'), '{}');
    const receipt = await prepareManagedInference(
      f.repo,
      f.output,
      f.spec,
      f.dependencies,
      f.environment,
    );
    const verified = await verifyManagedInference(f.output, f.spec);
    expect(receipt.source.revision).toBe(f.revision);
    expect(verified.bundle.spec.nodes[0]?.address).toBe('10.201.99.50');
    expect(verified.caddyfile).toContain('no admitted ready replica');
    expect(verified.compose.networks['inference-backend'].name).toBe(
      'north_internal',
    );
    expect(JSON.stringify(verified.compose)).not.toContain('ports');
    expect(f.calls.filter((args) => args[0] === 'pull')).toHaveLength(2);
    expect(verified.metadata.images.map((image) => image.reference)).toEqual(
      INFERENCE_IMAGES.map((image) => image.reference),
    );
  }, 30000);
  test('refuses cross-organization source before image acquisition', async () => {
    const f = await fixture();
    f.spec.identity!.slug = 'wrong-org';
    await expect(
      prepareManagedInference(
        f.repo,
        f.output,
        f.spec,
        f.dependencies,
        f.environment,
      ),
    ).rejects.toThrow('different deployment organization');
    expect(f.calls).toHaveLength(0);
  }, 30000);
  test.each(['source', 'route', 'image', 'extra', 'pin'] as const)(
    'refuses changed %s even after surrounding metadata hashes are rewritten',
    async (kind) => {
      const f = await fixture();
      await prepareManagedInference(
        f.repo,
        f.output,
        f.spec,
        f.dependencies,
        f.environment,
      );
      const file = join(f.output, 'managed.json');
      const metadata = JSON.parse(await readFile(file, 'utf8'));
      if (kind === 'source' || kind === 'route') {
        const target = kind === 'source' ? 'source.json' : 'router/Caddyfile';
        const old = await readFile(join(f.output, target), 'utf8');
        const changed =
          kind === 'source'
            ? old.replace(f.source.models[0]!.apiModel, 'Unreviewed-Model')
            : old.replace('401', '200');
        await writeFile(join(f.output, target), changed);
        metadata.files.find(
          (entry: { path: string }) => entry.path === target,
        ).sha256 = sha256(changed);
        if (kind === 'source') metadata.source.sha256 = sha256(changed);
      }
      if (kind === 'image') metadata.images[0].reference = 'caddy:latest';
      if (kind === 'extra') await writeFile(join(f.output, 'extra.json'), '{}');
      if (kind === 'pin') metadata.source.revision = 'a'.repeat(40);
      await writeFile(file, JSON.stringify(metadata));
      await expect(verifyManagedInference(f.output, f.spec)).rejects.toThrow();
    },
    30000,
  );
  test('holds a readiness hash mismatch before writing or pulling anything', async () => {
    const f = await fixture();
    const proof = join(f.root, 'ready.json');
    await writeFile(proof, '{}');
    f.spec.inference!.readiness = [
      { file: { env: 'TALE_READY_FILE' }, sha256: 'f'.repeat(64) },
    ];
    await expect(
      prepareManagedInference(f.repo, f.output, f.spec, f.dependencies, {
        ...f.environment,
        TALE_READY_FILE: proof,
      }),
    ).rejects.toThrow('selected SHA-256');
    expect(f.calls).toHaveLength(0);
  }, 30000);
});

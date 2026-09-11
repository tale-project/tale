import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareInference, verifyInferenceBundle } from './bundle';
import { inferenceFixture } from './tests/fixture';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tale-inference-bundle-'));
  roots.push(root);
  const spec = join(root, 'spec.json');
  await writeFile(spec, JSON.stringify(inferenceFixture()));
  const output = join(root, 'bundle');
  const bundle = await prepareInference(spec, output);
  return { root, output, bundle };
}
describe('offline inference bundle custody', () => {
  test('prepares deterministic public metadata without credentials or weights', async () => {
    const first = await fixture();
    const second = await fixture();
    expect(first.bundle.bundleSha256).toBe(second.bundle.bundleSha256);
    expect(
      await verifyInferenceBundle(first.output, first.bundle.bundleSha256),
    ).toEqual(first.bundle);
    expect(
      await readFile(join(first.output, 'inference.json'), 'utf8'),
    ).not.toContain('Bearer');
  });
  test.each(['file', 'runtime', 'unknown', 'pin'])(
    'refuses changed selected bundle %s',
    async (kind) => {
      const f = await fixture();
      const file = join(f.output, 'inference.json');
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (kind === 'file')
        value.spec.models[0].files[0].sha256 = 'd'.repeat(64);
      if (kind === 'runtime') value.runtime.sha256 = 'd'.repeat(64);
      if (kind === 'unknown') value.unrecognized = true;
      await writeFile(file, JSON.stringify(value));
      await expect(
        verifyInferenceBundle(
          f.output,
          kind === 'pin' ? 'f'.repeat(64) : f.bundle.bundleSha256,
        ),
      ).rejects.toThrow();
    },
  );
  test('rejects extra companions and existing output without replacing state', async () => {
    const f = await fixture();
    await mkdir(join(f.output, 'hidden'));
    await expect(verifyInferenceBundle(f.output)).rejects.toThrow(
      'contain only',
    );
    await expect(
      prepareInference(join(f.root, 'spec.json'), f.output),
    ).rejects.toThrow('already exists');
  });
  test('refuses a changed admission adapter even with an otherwise exact model manifest', async () => {
    const f = await fixture();
    const adapter = join(f.output, 'runtime-admission.py');
    const source = await readFile(adapter, 'utf8');
    await writeFile(
      adapter,
      source.replace('self.held = False', 'self.held = True '),
    );
    await expect(
      verifyInferenceBundle(f.output, f.bundle.bundleSha256),
    ).rejects.toThrow();
  });
});

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../config/releases/identity';
import {
  modelIdentity,
  parseInferenceSpec,
  runtimeModelDirectory,
} from './model';
import { installModel, verifyModel } from './models';
import { projectModelConfiguration } from './projection';
import { inferenceFixture } from './tests/fixture';

function fixture() {
  const config = {
    first_k_dense_replace: 1,
    index_skip_topk_offset: 1,
    index_topk_freq: 2,
    index_topk_pattern: null,
    indexer_rope_interleave: true,
    indexer_types: ['full', 'shared'],
    mlp_layer_types: ['dense', 'sparse'],
    model_file: 'glm_moe_dsa.py',
    model_type: 'glm_moe_dsa',
    moe_layer_freq: 1,
    num_hidden_layers: 2,
    quantization: { bits: 4, group_size: 64 },
    rope_interleave: true,
    unrelated_preserved_fact: 'synthetic retained setting',
  };
  const original = Buffer.from(JSON.stringify(config));
  const expected = { ...config };
  const derived = Object.fromEntries(
    Object.entries(expected)
      .filter(([key]) => key !== 'model_file')
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const runtime = Buffer.from(JSON.stringify(derived) + '\n');
  const shard = Buffer.from('synthetic shard without executable model weights');
  const raw = inferenceFixture();
  const model = parseInferenceSpec({
    ...raw,
    models: [
      {
        ...raw.models[0],
        files: [
          {
            path: 'config.json',
            bytes: original.length,
            sha256: sha256(original),
          },
          {
            path: 'model.safetensors',
            bytes: shard.length,
            sha256: sha256(shard),
          },
        ],
        configurationProjection: {
          kind: 'signed-omlx-glm-dsa',
          sourceSha256: sha256(original),
          removeModelFile: 'glm_moe_dsa.py',
          runtimeSha256: sha256(runtime),
        },
      },
    ],
  }).models[0]!;
  return { config, original, derived, runtime, shard, model };
}
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
describe('bounded signed-runtime configuration projection', () => {
  test('removes only the exact selector, keeps original bytes, and binds both hashes into identity', () => {
    const f = fixture();
    expect(projectModelConfiguration(f.model, f.original)).toEqual(f.runtime);
    expect(
      JSON.parse(projectModelConfiguration(f.model, f.original).toString()),
    ).toEqual(f.derived);
    expect(JSON.parse(f.original.toString())).toHaveProperty(
      'model_file',
      'glm_moe_dsa.py',
    );
    const { configurationProjection: _projection, ...unprojected } = f.model;
    expect(modelIdentity(f.model)).not.toBe(modelIdentity(unprojected));
  });
  test.each([
    'original-hash',
    'runtime-hash',
    'selector',
    'indexers',
    'mlp',
    'quantization',
  ])('refuses %s drift rather than accepting arbitrary overrides', (change) => {
    const f = fixture();
    if (change === 'original-hash')
      f.model.configurationProjection!.sourceSha256 = '0'.repeat(64);
    if (change === 'runtime-hash')
      f.model.configurationProjection!.runtimeSha256 = '0'.repeat(64);
    if (change === 'selector') f.config.model_file = 'arbitrary.py';
    if (change === 'indexers') f.config.indexer_types = ['shared', 'full'];
    if (change === 'mlp') f.config.mlp_layer_types = ['sparse', 'dense'];
    if (change === 'quantization') f.config.quantization.bits = 3;
    const bytes = Buffer.from(JSON.stringify(f.config));
    if (!change.includes('hash'))
      f.model.configurationProjection!.sourceSha256 = sha256(bytes);
    expect(() => projectModelConfiguration(f.model, bytes)).toThrow();
  });
  test.skipIf(process.platform === 'win32')(
    'materializes a data-only runtime view while preserving original config and exact shard bytes',
    async () => {
      const f = fixture();
      const root = await mkdtemp(join(tmpdir(), 'tale-inference-projection-'));
      roots.push(root);
      const blobs = new Map([
        ['config.json', f.original],
        ['model.safetensors', f.shard],
      ]);
      await installModel(root, f.model, async (input) => {
        await writeFile(input.file, blobs.get(input.file.split('/').at(-1)!)!, {
          flag: 'wx',
          mode: 0o600,
        });
        return 'downloaded';
      });
      expect(
        await readFile(
          join(root, 'models', modelIdentity(f.model), 'config.json'),
        ),
      ).toEqual(f.original);
      expect(
        await readFile(
          join(runtimeModelDirectory(root, f.model), 'config.json'),
        ),
      ).toEqual(f.runtime);
      expect(
        await readFile(
          join(runtimeModelDirectory(root, f.model), 'model.safetensors'),
        ),
      ).toEqual(f.shard);
      await verifyModel(root, f.model);
      const file = join(runtimeModelDirectory(root, f.model), 'config.json');
      await writeFile(file, f.original);
      await expect(verifyModel(root, f.model)).rejects.toThrow();
      expect(await readFile(file)).toEqual(f.original);
    },
  );
});

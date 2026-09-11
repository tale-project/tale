import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../config/releases/identity';
import { modelIdentity, parseInferenceSpec } from './model';
import { installModel, retainedModelBytes, verifyModel } from './models';
import { inferenceFixture } from './tests/fixture';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(indexTarget = 'model.safetensors') {
  const state = await mkdtemp(join(tmpdir(), 'tale-inference-files-'));
  roots.push(state);
  const bytes = new Map([
    ['config.json', Buffer.from('{"model_type":"glm_moe_dsa"}')],
    ['model.safetensors', Buffer.from('synthetic bytes, not a model')],
    [
      'model.safetensors.index.json',
      Buffer.from(JSON.stringify({ weight_map: { weight: indexTarget } })),
    ],
  ]);
  const raw = inferenceFixture();
  raw.models[0]!.files = [...bytes].map(([path, content]) => ({
    path,
    bytes: content.length,
    sha256: sha256(content),
  }));
  const model = parseInferenceSpec(raw).models[0]!;
  const directory = join(state, 'models', modelIdentity(model));
  let downloaded = 0;
  const download = async (input: { file: string }) => {
    downloaded++;
    const content = bytes.get(input.file.slice(directory.length + 1));
    await writeFile(input.file, content!, { flag: 'wx', mode: 0o600 });
    return 'downloaded' as const;
  };
  return {
    state,
    bytes,
    model,
    directory,
    download,
    downloaded: () => downloaded,
  };
}

describe.skipIf(process.platform === 'win32')(
  'actual owned model files, no weights',
  () => {
    test('credits only completed verified files and validates the complete architecture/index', async () => {
      const f = await fixture();
      expect(await retainedModelBytes(f.state, f.model)).toBe(0);
      await installModel(f.state, f.model, f.download);
      expect(await retainedModelBytes(f.state, f.model)).toBe(
        [...f.bytes.values()].reduce((sum, bytes) => sum + bytes.length, 0),
      );
      await verifyModel(f.state, f.model);
      expect(
        (await lstat(join(f.state, 'models/.metadata_never_index'))).size,
      ).toBe(0);
      await writeFile(join(f.directory, 'model.safetensors'), 'wrong');
      await expect(retainedModelBytes(f.state, f.model)).rejects.toThrow();
    });
    test('rejects an index naming an undeclared shard even when its manifest hash matches', async () => {
      const f = await fixture('missing.safetensors');
      await expect(installModel(f.state, f.model, f.download)).rejects.toThrow(
        'absent or undeclared',
      );
    });
    test('refuses a symlinked model root before downloading or truncating anything', async () => {
      const f = await fixture();
      const outside = join(f.state, 'retained');
      await mkdir(outside);
      await writeFile(join(outside, '.metadata_never_index'), 'preserve');
      await symlink(outside, join(f.state, 'models'));
      await expect(installModel(f.state, f.model, f.download)).rejects.toThrow(
        'symlink',
      );
      expect(f.downloaded()).toBe(0);
      expect(
        await readFile(join(outside, '.metadata_never_index'), 'utf8'),
      ).toBe('preserve');
    });
    test('refuses writable existing model ancestors during retained-byte admission', async () => {
      const f = await fixture();
      await installModel(f.state, f.model, f.download);
      await chmod(f.directory, 0o777);
      await expect(retainedModelBytes(f.state, f.model)).rejects.toThrow(
        'private regular',
      );
    });
    test('refuses repository code before acquiring any weight shard', async () => {
      const f = await fixture();
      const contents = Buffer.from(
        '{"model_type":"glm_moe_dsa","model_file":"glm_moe_dsa.py"}',
      );
      f.bytes.set('config.json', contents);
      f.model.files = f.model.files.map((file) =>
        file.path === 'config.json'
          ? {
              path: file.path,
              bytes: contents.length,
              sha256: sha256(contents),
            }
          : file,
      );
      // Manifest ordering is untrusted; metadata admission still runs first.
      f.model.files.reverse();
      await expect(installModel(f.state, f.model, f.download)).rejects.toThrow(
        'remote code is never enabled',
      );
      expect(f.downloaded()).toBe(1);
    });
    test('refuses writable retained files before granting disk admission credit', async () => {
      const f = await fixture();
      await installModel(f.state, f.model, f.download);
      await chmod(join(f.directory, 'model.safetensors'), 0o666);
      await expect(retainedModelBytes(f.state, f.model)).rejects.toThrow(
        'owned and private',
      );
    });
  },
);

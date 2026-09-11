import { randomUUID } from 'node:crypto';
import { lstat, readdir, readFile, link, open, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { downloadArtifact, modelDownloadUrl } from './download';
import {
  boundedJson,
  excludeRegenerableDirectory,
  fileDigest,
  ownedDirectory,
} from './files';
import {
  modelIdentity,
  runtimeModelDirectory,
  type InferenceModel,
} from './model';
import { projectModelConfiguration } from './projection';

async function inventory(
  directory: string,
  prefix = '',
  budget = { entries: 0 },
): Promise<string[]> {
  const info = await lstat(join(directory, prefix));
  if (!info.isDirectory() || info.isSymbolicLink())
    throw preconditionError('Inference model directory must be regular.');
  const result: string[] = [];
  for (const file of await readdir(join(directory, prefix), {
    withFileTypes: true,
  })) {
    if (++budget.entries > 8192 || file.isSymbolicLink())
      throw preconditionError(
        'Inference model inventory contains too many entries or a symlink.',
      );
    const name = prefix ? `${prefix}/${file.name}` : file.name;
    if (file.isDirectory())
      result.push(...(await inventory(directory, name, budget)));
    else if (file.isFile()) result.push(name);
    else
      throw preconditionError('Inference model contains a non-regular file.');
  }
  return result.sort();
}

async function verifySourceModel(
  state: string,
  model: InferenceModel,
): Promise<void> {
  const directory = join(state, 'models', modelIdentity(model));
  const files = await inventory(directory);
  if (
    JSON.stringify(files) !==
    JSON.stringify(model.files.map((file) => file.path).sort())
  )
    throw preconditionError(
      'Inference model file inventory differs from its immutable manifest.',
    );
  for (const file of model.files)
    if (
      (await fileDigest(join(directory, file.path), file.bytes)) !== file.sha256
    )
      throw preconditionError(
        'Inference model bytes differ from their immutable SHA-256.',
      );
  await validateSourceConfiguration(state, model);
  for (const file of model.files.filter((entry) =>
    entry.path.endsWith('.safetensors.index.json'),
  )) {
    const index = z
      .object({ weight_map: z.record(z.string(), z.string()) })
      .safeParse(await boundedJson(join(directory, file.path)));
    if (
      !index.success ||
      Object.values(index.data.weight_map).some(
        (target) =>
          !model.files.some(
            (entry) => entry.path === target && target.endsWith('.safetensors'),
          ),
      )
    )
      throw preconditionError(
        'Inference weight index references an absent or undeclared shard.',
      );
  }
}

async function validateSourceConfiguration(
  state: string,
  model: InferenceModel,
): Promise<void> {
  const file = join(state, 'models', modelIdentity(model), 'config.json');
  const raw = await boundedJson(file);
  const configuration = z.object({ model_type: z.string() }).safeParse(raw);
  if (
    !configuration.success ||
    configuration.data.model_type !== model.modelType
  )
    throw preconditionError(
      'Inference model architecture differs from its declared runtime contract.',
    );
  if (model.configurationProjection) {
    projectModelConfiguration(model, await readFile(file));
  } else {
    const safe = z
      .object({
        model_file: z.never().optional(),
        auto_map: z.never().optional(),
      })
      .safeParse(raw);
    if (!safe.success)
      throw preconditionError(
        'A model requesting repository code requires the explicit supported projection; remote code is never enabled.',
      );
  }
}

export async function verifyModel(
  state: string,
  model: InferenceModel,
): Promise<void> {
  await verifySourceModel(state, model);
  if (!model.configurationProjection) return;
  const view = runtimeModelDirectory(state, model);
  const expected = projectModelConfiguration(
    model,
    await readFile(join(state, 'models', modelIdentity(model), 'config.json')),
  );
  if (
    JSON.stringify(await inventory(view)) !==
    JSON.stringify(model.files.map((file) => file.path).sort())
  )
    throw preconditionError(
      'Derived model inventory differs from the source data manifest.',
    );
  for (const file of model.files) {
    const size = file.path === 'config.json' ? expected.length : file.bytes;
    const hash =
      file.path === 'config.json'
        ? model.configurationProjection.runtimeSha256
        : file.sha256;
    if ((await fileDigest(join(view, file.path), size)) !== hash)
      throw preconditionError(
        'Derived model bytes differ from the bound runtime projection.',
      );
  }
}

async function createModelView(
  state: string,
  model: InferenceModel,
): Promise<void> {
  if (!model.configurationProjection) return;
  const source = join(state, 'models', modelIdentity(model));
  const view = runtimeModelDirectory(state, model);
  const projected = projectModelConfiguration(
    model,
    await readFile(join(source, 'config.json')),
  );
  for (const file of model.files) {
    await ownedDirectory(dirname(join(view, file.path)), state);
    try {
      if (file.path === 'config.json') {
        const temporary = join(
          state,
          'model-views',
          `.projection-${randomUUID()}`,
        );
        const handle = await open(temporary, 'wx', 0o600);
        try {
          try {
            await handle.writeFile(projected);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await link(temporary, join(view, file.path));
        } finally {
          await unlink(temporary);
        }
      } else await link(join(source, file.path), join(view, file.path));
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'EEXIST')
      )
        throw error;
    }
  }
}

export async function installModel(
  state: string,
  model: InferenceModel,
  download: typeof downloadArtifact = downloadArtifact,
): Promise<void> {
  const root = join(state, 'models');
  // Exclude only regenerable weights/cache from Spotlight. Account settings,
  // credentials, receipts and the global indexing policy remain untouched.
  await excludeRegenerableDirectory(root, state);
  const ordered = [...model.files].sort(
    (left, right) =>
      Number(right.path === 'config.json') -
      Number(left.path === 'config.json'),
  );
  for (const file of ordered) {
    await ownedDirectory(
      dirname(join(root, modelIdentity(model), file.path)),
      state,
    );
    await download({
      url: modelDownloadUrl(model, file.path),
      file: join(root, modelIdentity(model), file.path),
      bytes: file.bytes,
      sha256: file.sha256,
    });
    if (file.path === 'config.json')
      await validateSourceConfiguration(state, model);
  }
  await verifySourceModel(state, model);
  await createModelView(state, model);
  await verifyModel(state, model);
}

/** Only individually verified completed files reduce the free-space floor.
 * Missing shards have no credit; malformed, foreign or symlinked state holds. */
export async function retainedModelBytes(
  state: string,
  model: InferenceModel,
): Promise<number> {
  const directory = join(state, 'models', modelIdentity(model));
  const owner = await lstat(state);
  let total = 0;
  for (const file of model.files) {
    try {
      const target = join(directory, file.path);
      // Read-only ancestor checks: planning must never create model directories.
      let current = dirname(target);
      while (current !== state) {
        const info = await lstat(current);
        if (
          !info.isDirectory() ||
          info.isSymbolicLink() ||
          info.uid !== owner.uid ||
          (info.mode & 0o022) !== 0
        )
          throw preconditionError(
            'Retained model ancestors are not private regular directories.',
          );
        current = dirname(current);
      }
      const targetInfo = await lstat(target);
      if (targetInfo.uid !== owner.uid || (targetInfo.mode & 0o022) !== 0)
        throw preconditionError(
          'Retained model file is not owned and private.',
        );
      if ((await fileDigest(target, file.bytes)) !== file.sha256)
        throw preconditionError(
          'Retained model bytes differ from the immutable manifest.',
        );
      total += file.bytes;
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
      )
        throw error;
    }
  }
  return total;
}

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { deploymentConfigSchema } from '@tale/shared/schemas/deployment';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { externalDepError } from '../../utils/fail';
import { configurationTargetSchema } from '../config/platform-model';
import { valueHash } from '../config/releases/identity';
import { sha } from '../config/releases/model';
import { readPrivateJson, writePrivateJson } from '../state/private-files';
import { runtimeCommand, runtimeSleep } from './runtime-command';
import {
  hash,
  requireRuntime,
  type ApplyRuntimeOptions,
  type RuntimeDependencies,
} from './runtime-model';

const runtimeConfigurationEffectSchema = z.strictObject({
  deploymentBundleSha256: sha,
  configurationSha256: sha,
  target: configurationTargetSchema,
  resourceSha256: sha,
  config: deploymentConfigSchema,
});
export type RuntimeConfigurationEffect = z.infer<
  typeof runtimeConfigurationEffectSchema
>;

export const spawnerBootSchema = z.strictObject({
  containerId: z
    .string()
    .length(64)
    .regex(/^[a-f0-9]{64}$/),
  startedAt: z
    .string()
    .refine(
      (value) =>
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) &&
        !/\s/.test(value) &&
        Number.isFinite(Date.parse(value)) &&
        Date.parse(value) > 0 &&
        new Date(value).toISOString().slice(0, 19) === value.slice(0, 19),
    ),
});
type SpawnerBoot = z.infer<typeof spawnerBootSchema>;
const mountedConfigSchema = z.strictObject({
  file: z.enum(['deployment.yml', 'deployment.json']).nullable(),
  bytesSha256: sha,
});
const activationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    phase: z.enum(['pending', 'ready']),
    name: z.string(),
    stateDirectory: z.string(),
    composeProject: z.string(),
    runtimeBundleSha256: sha,
    effect: runtimeConfigurationEffectSchema,
    mounted: mountedConfigSchema,
    before: spawnerBootSchema,
    after: spawnerBootSchema.optional(),
  })
  .refine((value) => (value.phase === 'ready') === (value.after !== undefined));

// This fixed reader follows the spawner's boot lookup order. It exposes only
// the non-secret deployment resource, through its already-proved read-only
// config mount. No arbitrary path, credential or application writer is used.
const READ_CONFIGURATION = String.raw`
const fs = require('node:fs');
const root = '/app/platform-config';
if ((process.env.TALE_PLATFORM_SHARED_CONFIG_DIR ?? root) !== root) throw Error('config mount differs');
const directory = fs.lstatSync(root);
if (!directory.isDirectory() || directory.isSymbolicLink()) throw Error('config directory differs');
let result = {file:null,data:null};
for (const file of ['deployment.yml','deployment.json']) {
  const path = root + '/' + file;
  let fd;
  try { fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > 65536) throw Error('config file differs');
    const bytes = Buffer.alloc(65537);
    let size = 0;
    while (size < bytes.length) {
      const count = fs.readSync(fd, bytes, size, bytes.length-size, null);
      if (!count) break;
      size += count;
    }
    const after = fs.fstatSync(fd), named = fs.lstatSync(path);
    if (size !== before.size || !named.isFile() || named.isSymbolicLink() ||
        ['dev','ino','size','mtimeMs','ctimeMs','nlink'].some(k => before[k] !== after[k] || after[k] !== named[k])) throw Error('config changed');
    result = {file,data:bytes.subarray(0,size).toString('base64')};
  } finally { fs.closeSync(fd); }
  break;
}
process.stdout.write(JSON.stringify(result));
`;

function json(text: string): unknown {
  requireRuntime(text.length <= 100_000, 'Spawner response is oversized.');
  try {
    return JSON.parse(text);
  } catch {
    throw externalDepError('Spawner returned invalid JSON.');
  }
}

async function mountedConfiguration(
  containerId: string,
  effect: RuntimeConfigurationEffect,
  dependencies: RuntimeDependencies,
) {
  const response = await runtimeCommand(
    ['exec', containerId, 'timeout', '15', 'bun', '-e', READ_CONFIGURATION],
    dependencies,
    { timeout: 20 },
  );
  const parsed = z
    .strictObject({
      file: z.enum(['deployment.yml', 'deployment.json']).nullable(),
      data: z.string().max(90_000).nullable(),
    })
    .parse(json(response.stdout));
  requireRuntime(
    (parsed.file === null) === (parsed.data === null),
    'Spawner configuration readback is incomplete.',
  );
  const bytes = Buffer.from(parsed.data ?? '', 'base64');
  requireRuntime(
    bytes.length <= 65536 && bytes.toString('base64') === (parsed.data ?? ''),
    'Spawner configuration encoding differs.',
  );
  let config: unknown;
  try {
    config = deploymentConfigSchema.parse(
      parsed.file === null ? { version: 1 } : parseYaml(bytes.toString('utf8')),
    );
  } catch {
    throw externalDepError('Spawner deployment configuration is malformed.');
  }
  requireRuntime(
    valueHash(config) === effect.resourceSha256,
    'Spawner mounted configuration differs from the verified native resource.',
  );
  return { file: parsed.file, bytesSha256: hash(bytes) };
}

async function control(
  containerId: string,
  command: 'drain' | 'drain-status',
  dependencies: RuntimeDependencies,
) {
  const result = await runtimeCommand(
    [
      'exec',
      containerId,
      'timeout',
      '15',
      'bun',
      '/app/src/control-cli.ts',
      command,
    ],
    dependencies,
    { timeout: 20 },
  );
  return json(result.stdout);
}
async function status(containerId: string, dependencies: RuntimeDependencies) {
  const result = z
    .strictObject({
      draining: z.boolean(),
      sessions: z.number().int().nonnegative(),
      sessionIds: z.array(z.string().min(1).max(128)).max(10000),
    })
    .parse(await control(containerId, 'drain-status', dependencies));
  requireRuntime(
    result.sessions === result.sessionIds.length &&
      new Set(result.sessionIds).size === result.sessions,
    'Spawner drain status is inconsistent.',
  );
  return result;
}

/** The caller holds the existing deployment lock. observe/wait reuse the
 * complete runtime custody and health gates; they never identify by a guessed
 * container name. A new boot reconciles an accepted restart response loss. */
export async function activateConfiguration(
  options: ApplyRuntimeOptions,
  input: RuntimeConfigurationEffect,
  runtimeBundleSha256: string,
  observe: () => Promise<SpawnerBoot>,
  wait: () => Promise<void>,
  dependencies: RuntimeDependencies,
) {
  const effect = runtimeConfigurationEffectSchema.parse(input);
  requireRuntime(
    effect.target.origin === options.origin &&
      valueHash(effect.config) === effect.resourceSha256,
    'Runtime configuration target or resource differs.',
  );
  const path = join(
    options.stateDirectory,
    '.tale',
    'configuration-runtime.json',
  );
  const previous = existsSync(path)
    ? activationSchema.parse(
        await readPrivateJson(path, process.getuid?.() ?? -1),
      )
    : undefined;
  const identity = {
    name: options.name,
    stateDirectory: options.stateDirectory,
    composeProject: options.composeProject,
    runtimeBundleSha256,
    effect,
  };
  const matches =
    previous &&
    Object.entries(identity).every(
      ([key, value]) =>
        valueHash(previous[key as keyof typeof previous]) === valueHash(value),
    );
  requireRuntime(
    previous?.phase !== 'pending' || matches,
    'A different configuration activation is pending. Recover that exact deployment first.',
  );
  const boot = spawnerBootSchema.parse(await observe());
  const mounted = await mountedConfiguration(
    boot.containerId,
    effect,
    dependencies,
  );
  if (matches)
    requireRuntime(
      valueHash(previous.mounted) === valueHash(mounted),
      'Spawner configuration bytes changed during activation.',
    );
  if (
    matches &&
    previous.phase === 'ready' &&
    valueHash(previous.after) === valueHash(boot)
  ) {
    await wait();
    requireRuntime(
      !(await status(boot.containerId, dependencies)).draining,
      'Ready spawner is draining; configuration activation cannot be claimed.',
    );
    requireRuntime(
      valueHash(await observe()) === valueHash(boot) &&
        valueHash(
          await mountedConfiguration(boot.containerId, effect, dependencies),
        ) === valueHash(mounted),
      'Spawner changed during activation readback.',
    );
    return previous;
  }
  // A later unreceipted boot still needs an observed restart against these
  // bytes. Only a retained pending intent may reconcile a changed boot.
  const pending =
    matches && previous.phase === 'pending'
      ? previous
      : activationSchema.parse({
          schemaVersion: 1,
          phase: 'pending',
          ...identity,
          mounted,
          before: boot,
        });
  if (pending !== previous) await writePrivateJson(path, pending);
  if (valueHash(pending.before) === valueHash(boot)) {
    z.strictObject({ draining: z.literal(true) }).parse(
      await control(boot.containerId, 'drain', dependencies),
    );
    let drained = false;
    const deadline = performance.now() + 300_000;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (performance.now() >= deadline) break;
      const observed = await status(boot.containerId, dependencies);
      requireRuntime(
        observed.draining,
        'Spawner did not retain its drain latch.',
      );
      if (observed.sessions === 0) {
        drained = true;
        break;
      }
      if (attempt !== 59 && performance.now() < deadline)
        await runtimeSleep(
          dependencies,
          Math.min(5000, deadline - performance.now()),
        );
    }
    requireRuntime(
      drained,
      'Spawner still has active sessions; configuration activation remains pending.',
    );
    requireRuntime(
      valueHash(await observe()) === valueHash(boot) &&
        valueHash(
          await mountedConfiguration(boot.containerId, effect, dependencies),
        ) === valueHash(mounted),
      'Spawner changed before configuration restart.',
    );
    await runtimeCommand(
      ['restart', '--time', '30', boot.containerId],
      dependencies,
      { timeout: 90 },
    );
  }
  await wait();
  const after = spawnerBootSchema.parse(await observe());
  requireRuntime(
    after.startedAt !== pending.before.startedAt,
    'Spawner restart did not establish a new boot.',
  );
  requireRuntime(
    !(await status(after.containerId, dependencies)).draining,
    'Restarted spawner is still draining.',
  );
  requireRuntime(
    valueHash(
      await mountedConfiguration(after.containerId, effect, dependencies),
    ) === valueHash(mounted) && valueHash(await observe()) === valueHash(after),
    'Spawner changed during activation readback.',
  );
  const ready = activationSchema.parse({ ...pending, phase: 'ready', after });
  await writePrivateJson(path, ready);
  return ready;
}

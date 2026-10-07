import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { sha256, stableJson } from '../config/releases/identity';
import { gitSha, relativePath, sha } from '../config/releases/model';
import { verifyPreparedDeploymentConfig } from './config-source';
import { deploymentSpecSchema } from './model';

export const deploymentBundleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('tale-deployment'),
  deploymentRef: gitSha.optional(),
  cli: z.strictObject({ revision: gitSha, path: z.literal('cli/tale') }),
  spec: deploymentSpecSchema,
  files: z
    .array(
      z.strictObject({
        path: relativePath,
        sha256: sha,
        bytes: z.number().int().nonnegative().max(268_435_456),
        executable: z.boolean(),
      }),
    )
    .min(3)
    .max(10_000),
});
export type DeploymentBundle = z.infer<typeof deploymentBundleSchema>;
/** A caller's whole-operation budget: milliseconds left, throwing once none remain. */
type BundleDeadline = () => number;

/** Settle within the caller's budget. A stalled storage call may finish in the
 * background, but it cannot hold a bounded operation past its deadline. */
async function bounded<T>(
  deadline: BundleDeadline | undefined,
  step: () => Promise<T>,
): Promise<T> {
  if (!deadline) return step();
  deadline();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    const watch = () => {
      try {
        timer = setTimeout(watch, deadline());
      } catch (error) {
        reject(error);
      }
    };
    watch();
  });
  try {
    return await Promise.race([step(), expiry]);
  } finally {
    clearTimeout(timer);
  }
}

/** Inspect the whole selected directory. Symlinks, hidden state, special files
 * and undeclared companions are not allowed to hitchhike with a deployment. */
async function bundleFiles(
  directory: string,
  prefix = '',
  budget = { entries: 0, bytes: 0 },
  deadline?: BundleDeadline,
): Promise<DeploymentBundle['files']> {
  const result: DeploymentBundle['files'] = [];
  for (const entry of await bounded(deadline, () =>
    readdir(join(directory, prefix), { withFileTypes: true }),
  )) {
    budget.entries++;
    if (budget.entries > 20_000)
      throw preconditionError('Deployment bundle contains too many entries.');
    if (!prefix && entry.name === 'deployment.json') continue;
    if (entry.name.startsWith('.') || entry.isSymbolicLink())
      throw preconditionError(
        'Deployment bundle contains hidden state or a symlink.',
      );
    const relative = relativePath.parse(
      prefix ? `${prefix}/${entry.name}` : entry.name,
    );
    if (entry.isDirectory()) {
      result.push(
        ...(await bundleFiles(directory, relative, budget, deadline)),
      );
      continue;
    }
    if (!entry.isFile())
      throw preconditionError('Deployment bundle contains a non-regular file.');
    const absolute = join(directory, relative);
    const info = await bounded(deadline, () => lstat(absolute));
    if (info.size > 268_435_456)
      throw preconditionError('Deployment bundle file exceeds the size limit.');
    const bytes = await bounded(deadline, () => readFile(absolute));
    budget.bytes += bytes.length;
    if (budget.bytes > 2_147_483_648)
      throw preconditionError(
        'Deployment bundle exceeds its total size limit.',
      );
    result.push({
      path: relative,
      bytes: bytes.length,
      sha256: sha256(bytes),
      executable: Boolean(info.mode & 0o111),
    });
  }
  return result.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

export async function writeDeploymentBundle(
  directory: string,
  metadata: Omit<DeploymentBundle, 'files'>,
): Promise<DeploymentBundle> {
  const bundle = deploymentBundleSchema.parse({
    ...metadata,
    files: await bundleFiles(directory),
  });
  await writeFile(
    join(directory, 'deployment.json'),
    `${JSON.stringify(bundle, null, 2)}\n`,
    { mode: 0o644, flag: 'wx' },
  );
  return bundle;
}

export async function verifyDeploymentBundle(
  directory: string,
  expected: { cliRef?: string; deploymentRef?: string } = {},
  deadline?: BundleDeadline,
): Promise<DeploymentBundle> {
  for (const revision of [expected.cliRef, expected.deploymentRef])
    if (revision !== undefined && !gitSha.safeParse(revision).success)
      throw preconditionError(
        'Expected deployment source pins must be full commit SHAs.',
      );
  const root = resolve(directory);
  const rootInfo = await bounded(deadline, () => lstat(root));
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw preconditionError('Deployment bundle must be a regular directory.');
  const info = await bounded(deadline, () =>
    lstat(join(root, 'deployment.json')),
  );
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4_194_304)
    throw preconditionError(
      'Deployment manifest is not a bounded regular file.',
    );
  const bundle = deploymentBundleSchema.parse(
    JSON.parse(
      await bounded(deadline, () =>
        readFile(join(root, 'deployment.json'), 'utf8'),
      ),
    ),
  );
  if (
    (expected.cliRef !== undefined &&
      bundle.cli.revision !== expected.cliRef) ||
    (expected.deploymentRef !== undefined &&
      bundle.deploymentRef !== expected.deploymentRef)
  )
    throw preconditionError(
      'Deployment bundle differs from the selected source pins.',
    );
  if (
    typeof bundle.spec.runtime.revision !== 'string' ||
    bundle.spec.configs.some((config) => typeof config.revision !== 'string')
  )
    throw preconditionError(
      'Prepared deployment contains an unresolved source pin.',
    );
  const actual = await bundleFiles(root, '', undefined, deadline);
  if (stableJson(actual) !== stableJson(bundle.files))
    throw preconditionError(
      'Deployment bundle bytes or file inventory differ from its manifest.',
    );
  if (
    !actual.some((file) => file.path === bundle.cli.path && file.executable) ||
    !actual.some((file) => file.path === 'runtime/runtime.json') ||
    !actual.some((file) => file.path === 'runtime/compose.yml')
  )
    throw preconditionError(
      'Deployment bundle is missing its executable or runtime.',
    );
  for (const config of bundle.spec.configs) {
    const prepared = await bounded(deadline, () =>
      verifyPreparedDeploymentConfig(
        join(root, 'configs', config.client, config.automation),
        {
          clientId: config.client,
          automationName: config.automation,
          releaseRef: gitSha.parse(config.revision),
          sourceRepository: config.repository,
          deploymentRef: bundle.deploymentRef,
        },
      ),
    );
    if ((prepared.kind === 'source') !== (config.skillOwner === 'operator'))
      throw preconditionError(
        'Prepared configuration does not match its declared skill owner binding.',
      );
  }
  return bundle;
}

/** Apply only a private copy whose actual bytes satisfy the reviewed manifest.
 * A transfer directory can change during an image pull or a backup. Neither
 * the runtime nor the executable receiving private stdin may use that mutable
 * source after admission. The owned copy is removed when this operation ends.
 * With a deadline, every read and the removal wait stay inside the caller's
 * budget, and each private write is admitted by it first. */
export async function withFrozenDeployment<T>(
  directory: string,
  expected: { cliRef?: string; deploymentRef?: string },
  work: (directory: string, bundle: DeploymentBundle) => Promise<T>,
  deadline?: BundleDeadline,
): Promise<T> {
  const source = resolve(directory);
  const bundle = await verifyDeploymentBundle(source, expected, deadline);
  deadline?.();
  const frozen = await mkdtemp(join(tmpdir(), 'tale-apply-'));
  let failed = false;
  try {
    await chmod(frozen, 0o700);
    for (const file of bundle.files) {
      const bytes = await bounded(deadline, async () => {
        const handle = await open(
          join(source, file.path),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          const status = await handle.stat();
          if (
            !status.isFile() ||
            status.size !== file.bytes ||
            Boolean(status.mode & 0o111) !== file.executable
          )
            throw preconditionError(
              'Deployment bundle changed while preparing its private copy.',
            );
          return await handle.readFile();
        } finally {
          await handle.close();
        }
      });
      if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
        throw preconditionError(
          'Deployment bundle bytes changed while preparing its private copy.',
        );
      const target = join(frozen, file.path);
      deadline?.();
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, bytes, {
        mode: file.executable ? 0o700 : 0o600,
        flag: 'wx',
      });
    }
    const manifest = await bounded(deadline, () =>
      readFile(join(source, 'deployment.json')),
    );
    if (
      manifest.length > 4_194_304 ||
      stableJson(
        deploymentBundleSchema.parse(JSON.parse(manifest.toString('utf8'))),
      ) !== stableJson(bundle)
    )
      throw preconditionError(
        'Deployment manifest changed while preparing its private copy.',
      );
    deadline?.();
    await writeFile(join(frozen, 'deployment.json'), manifest, {
      mode: 0o600,
      flag: 'wx',
    });
    await verifyDeploymentBundle(frozen, expected, deadline);
    return await work(frozen, bundle);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    // Removal always starts. Waiting for it is part of the caller's budget,
    // and a primary failure keeps precedence over a late or failed removal.
    const removal = rm(frozen, { recursive: true, force: true }).then(
      () => undefined,
      (error: unknown) => ({ error }),
    );
    let cleanup: { error: unknown } | undefined;
    try {
      cleanup = await bounded(deadline, () => removal);
    } catch (error) {
      cleanup = { error };
    }
    if (cleanup && !failed) throw cleanup.error;
  }
}

export async function copyDeploymentCli(
  binary: string,
  directory: string,
  platform: string,
): Promise<void> {
  const bytes = await readFile(binary);
  const machine = bytes.length >= 20 ? bytes.readUInt16LE(18) : 0;
  if (
    !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    machine !== (platform === 'linux/amd64' ? 62 : 183)
  )
    throw preconditionError(
      'Prepare this bundle with a Linux Tale executable matching the destination architecture.',
    );
  const target = join(directory, 'cli');
  await mkdir(target, { mode: 0o755 });
  await writeFile(join(target, 'tale'), bytes, { mode: 0o755, flag: 'wx' });
  await chmod(join(target, 'tale'), 0o755);
  // Beside the executable, ship the interpreted bundle the backend-local
  // provision runs under the target's OWN bun. A compiled executable cannot
  // resolve the backend's dynamically imported node_modules (postgres,
  // better-auth), so that phase must run interpreted. It is the same reviewed
  // source, and its bytes ride the same manifest hashes as every other file.
  const interpreted = await readFile(`${binary}.mjs`);
  if (
    interpreted.length === 0 ||
    interpreted.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  )
    throw preconditionError(
      'Prepare this bundle with the interpreted Tale bundle beside the executable.',
    );
  await writeFile(join(target, 'tale.mjs'), interpreted, {
    mode: 0o644,
    flag: 'wx',
  });
}

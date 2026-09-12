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

/** Inspect the whole selected directory. Symlinks, hidden state, special files
 * and undeclared companions are not allowed to hitchhike with a deployment. */
async function bundleFiles(
  directory: string,
  prefix = '',
  budget = { entries: 0, bytes: 0 },
): Promise<DeploymentBundle['files']> {
  const result: DeploymentBundle['files'] = [];
  for (const entry of await readdir(join(directory, prefix), {
    withFileTypes: true,
  })) {
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
      result.push(...(await bundleFiles(directory, relative, budget)));
      continue;
    }
    if (!entry.isFile())
      throw preconditionError('Deployment bundle contains a non-regular file.');
    const absolute = join(directory, relative);
    const info = await lstat(absolute);
    if (info.size > 268_435_456)
      throw preconditionError('Deployment bundle file exceeds the size limit.');
    const bytes = await readFile(absolute);
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
): Promise<DeploymentBundle> {
  for (const revision of [expected.cliRef, expected.deploymentRef])
    if (revision !== undefined && !gitSha.safeParse(revision).success)
      throw preconditionError(
        'Expected deployment source pins must be full commit SHAs.',
      );
  const root = resolve(directory);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw preconditionError('Deployment bundle must be a regular directory.');
  const info = await lstat(join(root, 'deployment.json'));
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4_194_304)
    throw preconditionError(
      'Deployment manifest is not a bounded regular file.',
    );
  const bundle = deploymentBundleSchema.parse(
    JSON.parse(await readFile(join(root, 'deployment.json'), 'utf8')),
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
  const actual = await bundleFiles(root);
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
    const prepared = await verifyPreparedDeploymentConfig(
      join(root, 'configs', config.client, config.automation),
      {
        clientId: config.client,
        automationName: config.automation,
        releaseRef: gitSha.parse(config.revision),
        sourceRepository: config.repository,
        deploymentRef: bundle.deploymentRef,
      },
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
 * source after admission. The owned copy is removed when this operation ends. */
export async function withFrozenDeployment<T>(
  directory: string,
  expected: { cliRef?: string; deploymentRef?: string },
  work: (directory: string, bundle: DeploymentBundle) => Promise<T>,
): Promise<T> {
  const source = resolve(directory);
  const bundle = await verifyDeploymentBundle(source, expected);
  const frozen = await mkdtemp(join(tmpdir(), 'tale-apply-'));
  await chmod(frozen, 0o700);
  try {
    for (const file of bundle.files) {
      const handle = await open(
        join(source, file.path),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let bytes;
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
        bytes = await handle.readFile();
      } finally {
        await handle.close();
      }
      if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
        throw preconditionError(
          'Deployment bundle bytes changed while preparing its private copy.',
        );
      const target = join(frozen, file.path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, bytes, {
        mode: file.executable ? 0o700 : 0o600,
        flag: 'wx',
      });
    }
    const manifest = await readFile(join(source, 'deployment.json'));
    if (
      manifest.length > 4_194_304 ||
      stableJson(
        deploymentBundleSchema.parse(JSON.parse(manifest.toString('utf8'))),
      ) !== stableJson(bundle)
    )
      throw preconditionError(
        'Deployment manifest changed while preparing its private copy.',
      );
    await writeFile(join(frozen, 'deployment.json'), manifest, {
      mode: 0o600,
      flag: 'wx',
    });
    await verifyDeploymentBundle(frozen, expected);
    return await work(frozen, bundle);
  } finally {
    await rm(frozen, { recursive: true, force: true });
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

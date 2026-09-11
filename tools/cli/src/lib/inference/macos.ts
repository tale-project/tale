import { randomUUID } from 'node:crypto';
import { lstat, readFile, rename, statfs } from 'node:fs/promises';
import {
  arch,
  homedir,
  networkInterfaces,
  platform,
  totalmem,
  userInfo,
} from 'node:os';
import { join, posix } from 'node:path';

import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import { exec } from '../docker/exec';
import { INFERENCE_ADMISSION_FILENAME } from './admission';
import { downloadArtifact } from './download';
import { ownedDirectory, privateDirectory, writePrivateText } from './files';
import { OMLX_RUNTIME, type InferenceNode } from './model';
import { hardwareSchema, type InferenceHardware } from './plan';
import { launchAgentPlist } from './settings';

export type InferenceExec = typeof exec;
const systemEnvironment = {
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  LANG: 'en_US.UTF-8',
};
export function requireMacTarget(): void {
  if (platform() !== 'darwin' || arch() !== 'arm64')
    throw preconditionError(
      'Inference service operations require their declared macOS Apple Silicon destination. Prepare and plan can run on any supported CLI host.',
    );
}

export async function observeMacHardware(
  run: InferenceExec = exec,
): Promise<InferenceHardware> {
  requireMacTarget();
  const user = userInfo();
  const invoke = async (command: string, args: string[]) =>
    run(command, args, { silent: true, timeout: 15, env: systemEnvironment });
  const [version, host, groups, domain, disk, wired] = await Promise.all([
    invoke('/usr/bin/sw_vers', ['-productVersion']),
    invoke('/usr/sbin/scutil', ['--get', 'LocalHostName']),
    invoke('/usr/bin/id', ['-Gn']),
    invoke('/bin/launchctl', ['print', `gui/${user.uid}`]),
    statfs(homedir(), { bigint: true }),
    invoke('/usr/sbin/sysctl', ['-n', 'iogpu.wired_limit_mb']),
  ]);
  if (!version.success || !host.success || !groups.success)
    throw preconditionError(
      'The destination macOS identity could not be observed.',
    );
  return hardwareSchema.parse({
    platform: platform(),
    architecture: arch(),
    macOSMajor: Number(version.stdout.split('.')[0]),
    user: user.username,
    uid: user.uid,
    home: homedir(),
    hostName: host.stdout,
    administrator: groups.stdout.split(/\s+/).includes('admin'),
    launchdUserDomain: domain.success,
    addresses: Object.values(networkInterfaces()).flatMap(
      (entries) => entries?.map((entry) => entry.address) ?? [],
    ),
    memoryBytes: totalmem(),
    freeDiskBytes: Number(disk.bavail * disk.bsize),
    ...(wired.success && /^\d+$/.test(wired.stdout.trim())
      ? { metalWiredLimitBytes: Number(wired.stdout.trim()) * 1024 ** 2 }
      : {}),
  });
}

export async function verifyOmlxApp(
  app: string,
  run: InferenceExec = exec,
): Promise<void> {
  const info = await lstat(app);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw preconditionError('The pinned oMLX app must be a regular directory.');
  for (const [command, args] of [
    ['/usr/bin/codesign', ['--verify', '--deep', '--strict', app]],
    ['/usr/sbin/spctl', ['--assess', '--type', 'execute', app]],
  ] as const) {
    const result = await run(command, [...args], {
      silent: true,
      timeout: 180,
      env: systemEnvironment,
    });
    if (!result.success)
      throw preconditionError(
        'The oMLX app did not pass Apple signature and notarization verification. Retain operating-system security settings.',
      );
  }
  const signing = await run(
    '/usr/bin/codesign',
    ['-dv', '--arch', 'arm64', '--verbose=4', app],
    {
      silent: true,
      timeout: 30,
      env: systemEnvironment,
    },
  );
  const metadata = signing.stdout + '\n' + signing.stderr;
  if (
    !signing.success ||
    !metadata.split('\n').includes(`TeamIdentifier=${OMLX_RUNTIME.teamId}`) ||
    !metadata
      .split('\n')
      .includes(`Identifier=${OMLX_RUNTIME.bundleIdentifier}`) ||
    !metadata
      .split('\n')
      .includes(`CandidateCDHashFull sha256=${OMLX_RUNTIME.arm64CodeDirectory}`)
  )
    throw preconditionError(
      'The oMLX app signer, identifier or signed content differs from the approved runtime.',
    );
  const version = await run(
    '/usr/bin/plutil',
    [
      '-extract',
      'CFBundleShortVersionString',
      'raw',
      '-o',
      '-',
      join(app, 'Contents/Info.plist'),
    ],
    { silent: true, timeout: 15, env: systemEnvironment },
  );
  if (!version.success || version.stdout !== OMLX_RUNTIME.version)
    throw preconditionError(
      'The oMLX app version differs from the approved runtime.',
    );
}

export async function installOmlxRuntime(
  state: string,
  run: InferenceExec = exec,
): Promise<string> {
  const root = join(state, 'runtimes', OMLX_RUNTIME.sha256);
  await ownedDirectory(join(state, 'runtimes'), state);
  const app = join(root, 'oMLX.app');
  try {
    await lstat(app);
    await verifyOmlxApp(app, run);
    return app;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  const image = join(state, 'downloads', `omlx-${OMLX_RUNTIME.sha256}.dmg`);
  await ownedDirectory(join(state, 'downloads'), state);
  await downloadArtifact({ ...OMLX_RUNTIME, file: image });
  const scratch = join(state, 'runtimes', `.pending-${randomUUID()}`);
  const mount = join(state, 'mounts', randomUUID());
  await ownedDirectory(scratch, state);
  await ownedDirectory(mount, state);
  let attached = false;
  let failure: unknown;
  try {
    const result = await run(
      '/usr/bin/hdiutil',
      ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, image],
      { silent: true, timeout: 180, env: systemEnvironment },
    );
    if (!result.success)
      throw externalDepError(
        'The verified oMLX disk image could not be mounted read-only.',
      );
    attached = true;
    await verifyOmlxApp(join(mount, 'oMLX.app'), run);
    const copied = await run(
      '/usr/bin/ditto',
      [join(mount, 'oMLX.app'), join(scratch, 'oMLX.app')],
      { silent: true, timeout: 600, env: systemEnvironment },
    );
    if (!copied.success)
      throw externalDepError('The verified oMLX app could not be staged.');
    await verifyOmlxApp(join(scratch, 'oMLX.app'), run);
    await rename(scratch, root);
  } catch (error) {
    failure = error;
  } finally {
    if (attached) {
      const detached = await run('/usr/bin/hdiutil', ['detach', mount], {
        silent: true,
        timeout: 60,
        env: systemEnvironment,
      });
      if (!detached.success) {
        failure = externalDepError(
          'The owned read-only oMLX image is still mounted. Detach its recorded mount before retrying.',
        );
      }
    }
  }
  if (failure) throw failure;
  return app;
}

/** Fixed code, verified bundled Python and sanitized environment. This runs on
 * the target only. Merely finding a .so file is not a native-kernel proof. */
export async function probeOmlxRuntime(
  app: string,
  node: InferenceNode,
  run: InferenceExec = exec,
): Promise<
  Pick<InferenceHardware, 'availableKernels' | 'metalWorkingSetBytes'>
> {
  const resources = join(app, 'Contents/Resources');
  const pythonHome = join(resources, 'Python/cpython-3.11');
  const result = await run(
    join(pythonHome, 'bin/python3'),
    [
      '-s',
      '-c',
      'import json; import mlx.core as mx; from omlx.custom_kernels import native_kernel_status; info=mx.device_info(); print(json.dumps({"metalWorkingSetBytes":info["max_recommended_working_set_size"],"availableKernels":[key for key,value in native_kernel_status().items() if value.get("available") is True]}))',
    ],
    {
      silent: true,
      timeout: 120,
      env: {
        ...systemEnvironment,
        HOME: `/Users/${node.user}`,
        PYTHONHOME: pythonHome,
        PYTHONPATH: `${resources}:${resources}/Python/framework-mlx-base/lib/python3.11/site-packages`,
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONNOUSERSITE: '1',
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
      },
    },
  );
  if (!result.success || result.stdout.length > 65536)
    throw preconditionError(
      'The pinned oMLX runtime could not prove Metal capacity and native-kernel availability.',
    );
  try {
    return z
      .strictObject({
        metalWorkingSetBytes: z.number().int().positive().safe(),
        availableKernels: z.array(z.string()).max(64),
      })
      .parse(JSON.parse(result.stdout));
  } catch {
    throw preconditionError(
      'The pinned oMLX runtime returned an invalid kernel admission result.',
    );
  }
}

export async function activateLaunchAgent(
  node: InferenceNode,
  uid: number,
  plist: string,
  run: InferenceExec = exec,
): Promise<void> {
  const domain = `gui/${uid}`;
  const service = `${domain}/dev.tale.inference.${node.key}`;
  const launchAgents = `/Users/${node.user}/Library/LaunchAgents`;
  await privateDirectory(launchAgents, `/Users/${node.user}`, uid);
  const activePlist = join(
    launchAgents,
    `dev.tale.inference.${node.key}.plist`,
  );
  const validate = await run('/usr/bin/plutil', ['-lint', plist], {
    silent: true,
    timeout: 15,
    env: systemEnvironment,
  });
  if (!validate.success)
    throw preconditionError('The prepared inference LaunchAgent is invalid.');
  try {
    const info = await lstat(activePlist);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.uid !== uid ||
      (info.mode & 0o077) !== 0
    )
      throw preconditionError(
        'The inference LaunchAgent path is not a private owned file.',
      );
    const [label, workingDirectory] = await Promise.all([
      run(
        '/usr/bin/plutil',
        ['-extract', 'Label', 'raw', '-o', '-', activePlist],
        { silent: true, timeout: 15, env: systemEnvironment },
      ),
      run(
        '/usr/bin/plutil',
        ['-extract', 'WorkingDirectory', 'raw', '-o', '-', activePlist],
        { silent: true, timeout: 15, env: systemEnvironment },
      ),
    ]);
    const prefix = `/Users/${node.user}/Library/Application Support/Tale/inference/${node.key}/releases/`;
    if (
      !label.success ||
      label.stdout !== `dev.tale.inference.${node.key}` ||
      !workingDirectory.success ||
      !workingDirectory.stdout.startsWith(prefix) ||
      !/^[a-f0-9]{64}$/.test(workingDirectory.stdout.slice(prefix.length))
    )
      throw preconditionError(
        'An unrelated LaunchAgent already occupies this service identity.',
      );
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  const existing = await run('/bin/launchctl', ['print', service], {
    silent: true,
    timeout: 15,
    env: systemEnvironment,
  });
  if (existing.success) {
    const stopped = await run('/bin/launchctl', ['bootout', service], {
      silent: true,
      timeout: 60,
      env: systemEnvironment,
    });
    if (!stopped.success)
      throw externalDepError(
        'The existing inference service could not stop; activation is held.',
      );
  }
  await writePrivateText(activePlist, await readFile(plist, 'utf8'));
  const loaded = await run(
    '/bin/launchctl',
    ['bootstrap', domain, activePlist],
    {
      silent: true,
      timeout: 60,
      env: systemEnvironment,
    },
  );
  if (!loaded.success)
    throw externalDepError(
      'The inference LaunchAgent could not be activated. Retained releases and the pending receipt remain available.',
    );
}

function registeredLaunchAgent(
  output: string,
  node: InferenceNode,
  state: string,
  release: string,
) {
  const wanted = `/Users/${node.user}/Library/LaunchAgents/dev.tale.inference.${node.key}.plist`;
  const base = posix.join(state, 'releases', release);
  return (
    output.split('\n').some((line) => line.trim() === `path = ${wanted}`) &&
    output
      .split('\n')
      .some(
        (line) =>
          line.trim() === posix.join(base, INFERENCE_ADMISSION_FILENAME),
      )
  );
}

/** Refuse a lost receipt or independent writer before replacing any job. A
 * stopped but exact retained plist is recoverable; unknown print failures are
 * not evidence that a service is absent. This is a local snapshot, not CAS. */
export async function verifyLaunchAgentCustody(
  node: InferenceNode,
  uid: number,
  state: string,
  releases: readonly string[],
  run: InferenceExec = exec,
  inspectPlist: typeof persistedPlistMatches = persistedPlistMatches,
): Promise<void> {
  const file = `/Users/${node.user}/Library/LaunchAgents/dev.tale.inference.${node.key}.plist`;
  let present = true;
  try {
    await inspectPlist(file, '', uid);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
    present = false;
  }
  const loaded = await run(
    '/bin/launchctl',
    ['print', `gui/${uid}/dev.tale.inference.${node.key}`],
    {
      silent: true,
      timeout: 15,
      env: systemEnvironment,
    },
  );
  if (!loaded.success && loaded.exitCode !== 113)
    throw preconditionError(
      'The inference service inventory could not be verified.',
    );
  if (!present && !loaded.success) return;
  for (const release of releases) {
    if (!/^[a-f0-9]{64}$/.test(release)) continue;
    if (
      present &&
      (await inspectPlist(
        file,
        launchAgentPlist(
          node,
          state,
          release,
          posix.join(state, 'runtimes', OMLX_RUNTIME.sha256, 'oMLX.app'),
        ),
        uid,
      )) &&
      (!loaded.success ||
        registeredLaunchAgent(loaded.stdout, node, state, release))
    )
      return;
  }
  throw preconditionError(
    'An unrecorded or changed inference service occupies this identity. Retain its files and recover the matching receipt before activation.',
  );
}

export async function launchAgentMatches(
  node: InferenceNode,
  uid: number,
  state: string,
  release: string,
  run: InferenceExec = exec,
  inspectPlist: typeof persistedPlistMatches = persistedPlistMatches,
): Promise<boolean> {
  const result = await run(
    '/bin/launchctl',
    ['print', `gui/${uid}/dev.tale.inference.${node.key}`],
    { silent: true, timeout: 15, env: systemEnvironment },
  );
  // launchctl's path field identifies the exact submitted plist. It must also
  // report the running state; a registered but crash-looping job is not ready.
  const wanted = `/Users/${node.user}/Library/LaunchAgents/dev.tale.inference.${node.key}.plist`;
  const registered =
    result.success &&
    registeredLaunchAgent(result.stdout, node, state, release) &&
    result.stdout.split('\n').some((line) => line.trim() === 'state = running');
  if (!registered) return false;
  try {
    return await inspectPlist(
      wanted,
      launchAgentPlist(
        node,
        state,
        release,
        posix.join(state, 'runtimes', OMLX_RUNTIME.sha256, 'oMLX.app'),
      ),
      uid,
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return false;
    throw error;
  }
}

export async function persistedPlistMatches(
  file: string,
  expected: string,
  uid = process.getuid?.(),
): Promise<boolean> {
  const info = await lstat(file);
  return (
    info.isFile() &&
    !info.isSymbolicLink() &&
    info.nlink === 1 &&
    (uid === undefined || info.uid === uid) &&
    (info.mode & 0o077) === 0 &&
    (await readFile(file, 'utf8')) === expected
  );
}

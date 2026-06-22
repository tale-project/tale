import pkg from '../../../package.json';
import * as logger from '../../utils/logger';
import { findProject } from '../project/find-project';
import { readProject } from '../project/read-project';
import {
  type InstallHandle,
  type ReleaseInfo,
  commitInstall,
  installBinary,
  isDevBuild,
  resolveRelease,
} from './self-update';

/**
 * Automatic CLI ↔ instance version alignment.
 *
 * The CLI binary must always be the same version as the instance it manages.
 * The workspace records that version in `tale.json` (`cliVersion`), kept in
 * sync by `tale update` / `tale deploy`. On every command we compare the
 * compiled-in {@link pkg.version} against that field; when they match — the
 * overwhelmingly common case — this is a pure file read with zero network
 * cost. Only a genuine mismatch triggers a download + binary replace, after
 * which we re-exec the same command under the freshly-installed binary.
 *
 * There is no opt-out: the alignment is intentional and not user-configurable.
 * The one concession is robustness — if the target release can't be fetched
 * (offline, rate-limited, asset not uploaded), we warn and proceed with the
 * current binary rather than bricking the CLI.
 */

/** Set on a re-exec'd / spawned child to break any possibility of an align loop. */
export const ALIGN_GUARD_ENV = 'TALE_ALIGNED';

/**
 * Commands that manage versions themselves and must NOT trigger alignment:
 * `update` performs its own CLI bump + rollback, `init` runs before any
 * instance/workspace version exists, and `uninstall` is about to delete the
 * binary — aligning (download + re-exec) right before removal is wasteful and
 * would re-exec a binary we're tearing down.
 */
const SELF_MANAGING_COMMANDS = new Set(['update', 'init', 'uninstall']);

/**
 * Injectable seams (re-exec, network, binary I/O) so the decision logic is
 * unit-testable without real subprocesses or downloads. Production passes the
 * defaults below.
 */
export interface AlignDeps {
  currentVersion: string;
  isDevBuild: (version?: string) => boolean;
  findProject: () => string | null;
  readWorkspaceVersion: (dir: string) => Promise<string | null>;
  resolveRelease: (opts: {
    version?: string;
  }) => Promise<{ release: ReleaseInfo }>;
  installBinary: (release: ReleaseInfo) => Promise<InstallHandle>;
  commitInstall: (handle: InstallHandle) => Promise<void>;
  reExec: () => void;
}

const defaultDeps: AlignDeps = {
  currentVersion: pkg.version,
  isDevBuild,
  findProject,
  readWorkspaceVersion: async (dir) => (await readProject(dir)).cliVersion,
  resolveRelease,
  installBinary,
  commitInstall,
  reExec,
};

/**
 * Align the running binary to the workspace's recorded version, re-exec'ing
 * under the new binary on a mismatch. A no-op when already aligned, on a dev
 * build, outside a project, for self-managing commands, or in a re-exec'd
 * child.
 */
export async function ensureAligned(
  commandName: string | undefined,
  deps: AlignDeps = defaultDeps,
): Promise<void> {
  if (process.env[ALIGN_GUARD_ENV] === '1') return;
  if (deps.isDevBuild()) return;
  if (commandName && SELF_MANAGING_COMMANDS.has(commandName)) return;

  const projectDir = deps.findProject();
  if (!projectDir) return; // No instance to align to.

  let target: string | null;
  try {
    target = await deps.readWorkspaceVersion(projectDir);
  } catch (err) {
    // Unreadable / invalid tale.json — don't block the command on it.
    logger.debug(`align: could not read instance version: ${String(err)}`);
    return;
  }

  // The fast path: versions already match → nothing to do, no network.
  if (!target || target === deps.currentVersion) return;

  try {
    const { release } = await deps.resolveRelease({ version: target });
    logger.step(
      `Aligning CLI to instance version ${release.version} (currently ${deps.currentVersion})...`,
    );
    const handle = await deps.installBinary(release);
    await deps.commitInstall(handle);
  } catch (err) {
    logger.warn(
      `Could not align the CLI to instance version ${target}: ` +
        `${err instanceof Error ? err.message : String(err)}. ` +
        `Continuing with v${deps.currentVersion}.`,
    );
    return;
  }

  deps.reExec();
}

/**
 * Re-run the current invocation under the now-installed binary, passing a
 * guard env var so the child never re-aligns. Replaces this process.
 */
function reExec(): never {
  const result = Bun.spawnSync([process.execPath, ...process.argv.slice(2)], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, [ALIGN_GUARD_ENV]: '1' },
  });
  process.exit(result.exitCode ?? 0);
}

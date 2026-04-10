import { chmod, rename, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import pkg from '../../../package.json';
import { compareVersions, extractVersion } from '../../utils/compare-versions';
import * as logger from '../../utils/logger';
import { requireProject } from '../project/find-project';
import { update } from './update';

const COMPILED_BINARY_NAMES = new Set([
  'tale',
  'tale.exe',
  'tale_linux',
  'tale_macos',
  'tale_windows.exe',
]);

const GITHUB_REPO = 'tale-project/tale';

const SUPPORTED_TARGETS: Record<string, string> = {
  'linux-x64': 'tale_linux',
  'darwin-arm64': 'tale_macos',
  'win32-x64': 'tale_windows.exe',
};

interface UpgradeOptions {
  force?: boolean;
  dryRun?: boolean;
  internalSyncOnly?: boolean;
}

interface ReleaseInfo {
  tag: string;
  version: string;
}

function getAuthHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

async function fetchLatestRelease(): Promise<ReleaseInfo> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const response = await fetch(url, {
    headers: {
      ...getAuthHeaders(),
      'User-Agent': `tale-cli/${pkg.version}`,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 403) {
    throw new Error(
      'GitHub API returned 403. This may be rate limiting or an auth issue. ' +
        'Set GITHUB_TOKEN or GH_TOKEN for higher limits.',
    );
  }
  if (response.status === 404) {
    throw new Error(
      'No releases found. If this is a private repo, set GITHUB_TOKEN.',
    );
  }
  if (!response.ok) {
    throw new Error(
      `Failed to check for updates: GitHub API returned ${response.status}.`,
    );
  }

  const data = (await response.json()) as Record<string, unknown>;
  if (typeof data?.tag_name !== 'string' || !data.tag_name) {
    throw new Error(
      'Unexpected GitHub API response: missing or invalid tag_name.',
    );
  }
  const tag = data.tag_name;
  const version = extractVersion(tag);
  if (!version) {
    throw new Error(
      `Could not extract semver version from release tag "${tag}".`,
    );
  }
  return { tag, version };
}

function getAssetName(): string {
  const key = `${process.platform}-${process.arch}`;
  const asset = SUPPORTED_TARGETS[key];
  if (!asset) {
    throw new Error(
      `No pre-built binary available for ${key}.\nBuild from source: cd tools/cli && bun install && bun run build`,
    );
  }
  return asset;
}

function getInstallPath(): string {
  return process.execPath;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function downloadBinary(
  tag: string,
  asset: string,
  destPath: string,
): Promise<void> {
  const url = `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${asset}`;
  const response = await fetch(url, {
    headers: getAuthHeaders(),
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download ${asset}: server returned ${response.status}.`,
    );
  }

  const totalBytes = Number(response.headers.get('content-length')) || null;
  const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;

  if (!response.body) {
    await Bun.write(destPath, response);
  } else {
    const reader = response.body.getReader();
    const writer = Bun.file(destPath).writer();
    let downloadedBytes = 0;
    let lastPrintTime = 0;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        writer.write(value);
        downloadedBytes += value.byteLength;

        if (isTTY) {
          const now = Date.now();
          if (now - lastPrintTime >= 100) {
            lastPrintTime = now;
            const progress = totalBytes
              ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)} (${Math.round((downloadedBytes / totalBytes) * 100)}%)`
              : formatBytes(downloadedBytes);
            process.stdout.write(`\r  Downloading... ${progress}`);
          }
        }
      }
      await writer.end();
    } catch (err) {
      await writer.end();
      throw err;
    }

    if (isTTY) {
      process.stdout.write(
        `\x1b[2K\r  Downloaded ${formatBytes(downloadedBytes)}\n`,
      );
    }
  }

  if (process.platform !== 'win32') {
    await chmod(destPath, 0o755);
  }
}

async function verifyBinary(binaryPath: string, expectedVersion: string) {
  const result = Bun.spawnSync([binaryPath, '--version'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (result.exitCode !== 0) {
    throw new Error(
      'Downloaded binary failed verification (--version returned non-zero).',
    );
  }

  const output = result.stdout.toString().trim();
  if (!output.includes(expectedVersion)) {
    throw new Error(
      `Downloaded binary version mismatch: expected ${expectedVersion}, got "${output}".`,
    );
  }
}

async function replaceBinary(tmpPath: string, installPath: string) {
  const bakPath = `${installPath}.bak`;

  // Back up current binary (instant rename on same filesystem)
  try {
    await rename(installPath, bakPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(
        `Permission denied backing up ${installPath}. Try: sudo tale upgrade`,
        { cause: err },
      );
    }
    throw err;
  }

  // Move new binary into place — use shell mv to handle cross-filesystem (EXDEV)
  const mvArgs =
    process.platform === 'win32'
      ? ['cmd', '/c', 'move', '/y', tmpPath, installPath]
      : ['mv', tmpPath, installPath];

  const mvResult = Bun.spawnSync(mvArgs, { stdout: 'pipe', stderr: 'pipe' });
  let succeeded = mvResult.exitCode === 0;

  // Retry with sudo on permission error (Unix only)
  if (!succeeded && process.platform !== 'win32') {
    const stderr = mvResult.stderr.toString();
    if (
      stderr.includes('Permission denied') ||
      stderr.includes('Operation not permitted')
    ) {
      logger.info('Requesting sudo to install binary...');
      const sudoResult = Bun.spawnSync(['sudo', 'mv', tmpPath, installPath], {
        stdout: 'inherit',
        stderr: 'inherit',
        stdin: 'inherit',
      });
      succeeded = sudoResult.exitCode === 0;
    }
  }

  if (!succeeded) {
    // Attempt to restore backup
    try {
      await rename(bakPath, installPath);
    } catch {
      throw new Error(
        `Failed to install new binary to ${installPath}. ` +
          `Restore also failed — your previous binary is at ${bakPath}. ` +
          `Run: mv ${bakPath} ${installPath}`,
      );
    }
    throw new Error(
      `Failed to install new binary to ${installPath}. Previous version restored.`,
    );
  }

  // Clean up backup (best-effort)
  await unlink(bakPath).catch(() => {});
}

function replaceBinaryWindows(tmpPath: string, installPath: string) {
  const oldPath = `${installPath}.old`;

  // Clean up previous .old file if exists
  try {
    Bun.spawnSync(['cmd', '/c', 'del', '/f', oldPath], { stdout: 'pipe' });
  } catch {
    // ignore
  }

  // Windows allows renaming a running exe
  const renameOld = Bun.spawnSync(
    ['cmd', '/c', 'ren', installPath, 'tale.old.exe'],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  if (renameOld.exitCode !== 0) {
    throw new Error(
      `Failed to rename running binary. Try closing other tale processes.`,
    );
  }

  const renameNew = Bun.spawnSync(
    ['cmd', '/c', 'move', '/y', tmpPath, installPath],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  if (renameNew.exitCode !== 0) {
    // Attempt to restore
    Bun.spawnSync(
      ['cmd', '/c', 'ren', `${dirname(installPath)}\\tale.old.exe`, 'tale.exe'],
      { stdout: 'pipe' },
    );
    throw new Error(`Failed to place new binary. Previous version restored.`);
  }
}

export async function upgrade(options: UpgradeOptions): Promise<void> {
  // Phase 4 shortcut: internal sync-only mode (called after binary replacement)
  if (options.internalSyncOnly) {
    await update({
      force: options.force,
      dryRun: options.dryRun,
      skipHeader: true,
    });
    return;
  }

  // Guard against running in dev mode where process.execPath is the bun runtime
  const execName = basename(process.execPath);
  if (!COMPILED_BINARY_NAMES.has(execName)) {
    throw new Error(
      `Cannot self-upgrade when running via "${execName}". Build and install the compiled binary first.`,
    );
  }

  requireProject();

  const prefix = options.dryRun ? '[DRY-RUN] ' : '';
  logger.header(`${prefix}Upgrading Tale CLI`);

  // Phase 1: Version check
  logger.step(`${prefix}Checking for updates...`);
  let release: ReleaseInfo;
  try {
    release = await fetchLatestRelease();
  } catch (err) {
    throw new Error(
      `Could not check for updates. ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  const currentVersion = pkg.version;
  const comparison = compareVersions(release.version, currentVersion);

  logger.info(`Current version: ${currentVersion}`);
  logger.info(`Latest version:  ${release.version}`);

  const needsBinaryUpgrade = comparison > 0 || options.force;

  if (!needsBinaryUpgrade) {
    logger.success(`CLI is up to date (v${currentVersion})`);
    logger.blank();

    // Still sync project files even if binary is current
    logger.step(`${prefix}Syncing project files...`);
    await update({
      force: options.force,
      dryRun: options.dryRun,
      skipHeader: true,
    });
    return;
  }

  if (options.dryRun) {
    const asset = getAssetName();
    logger.info(`${prefix}Would download ${asset} from ${release.tag}`);
    logger.info(`${prefix}Would replace ${getInstallPath()}`);
    logger.blank();
    logger.step(
      `${prefix}Project file sync preview (based on current v${currentVersion} templates):`,
    );
    logger.info('Note: actual changes may differ after upgrading.');
    await update({
      force: options.force,
      dryRun: true,
      skipHeader: true,
    });
    return;
  }

  // Phase 2: Download & verify
  const asset = getAssetName();
  const tmpPath = join(tmpdir(), `tale-upgrade-${Date.now()}`);

  logger.step(`Downloading ${asset} (${release.tag})...`);
  try {
    await downloadBinary(release.tag, asset, tmpPath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }

  logger.step('Verifying downloaded binary...');
  try {
    await verifyBinary(tmpPath, release.version);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }

  // Phase 3: Replace binary
  logger.step('Installing new binary...');
  try {
    if (process.platform === 'win32') {
      replaceBinaryWindows(tmpPath, getInstallPath());
    } else {
      await replaceBinary(tmpPath, getInstallPath());
    }
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }

  logger.success(`CLI upgraded to v${release.version}`);

  // Phase 4: Sync project files using the NEW binary
  logger.blank();
  logger.step('Syncing project files with new version...');

  const installPath = getInstallPath();
  const syncArgs = [installPath, 'upgrade', '--internal-sync-only'];
  if (options.force) syncArgs.push('--force');

  const syncResult = Bun.spawnSync(syncArgs, {
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });

  if (syncResult.exitCode !== 0) {
    throw new Error(
      'Project file sync failed. The CLI binary was upgraded successfully. ' +
        'Run "tale upgrade --internal-sync-only" to retry syncing project files.',
    );
  }
}

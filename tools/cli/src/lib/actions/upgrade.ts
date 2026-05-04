import { chmod, rename, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import pkg from '../../../package.json';
import { compareVersions, extractVersion } from '../../utils/compare-versions';
import * as logger from '../../utils/logger';
import { requireProject } from '../project/find-project';
import { update } from './update';

const GITHUB_REPO = 'tale-project/tale';

// First release that ships `tale upgrade --internal-sync-only`. Older binaries
// don't have the subcommand, so re-spawning them with this flag would fail.
const MIN_VERSION_WITH_INTERNAL_SYNC = '0.2.8';

const SUPPORTED_TARGETS: Record<string, string> = {
  'linux-x64': 'tale_linux',
  'darwin-arm64': 'tale_macos',
  'win32-x64': 'tale_windows.exe',
};

interface UpgradeOptions {
  /** Install this exact version (e.g. "0.9.0" or "v0.9.0") instead of latest. */
  version?: string;
  force?: boolean;
  dryRun?: boolean;
  internalSyncOnly?: boolean;
}

function normalizeTag(input: string): string {
  const trimmed = input.trim();
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

interface ReleaseInfo {
  tag: string;
  version: string;
  assetNames: string[];
}

interface ReadyReleaseResult {
  release: ReleaseInfo;
  skipped: string[];
}

function getAuthHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

function parseRelease(data: Record<string, unknown>): ReleaseInfo | null {
  if (typeof data?.tag_name !== 'string' || !data.tag_name) return null;
  const tag = data.tag_name;
  const version = extractVersion(tag);
  if (!version) return null;
  const assetNames = Array.isArray(data.assets)
    ? data.assets
        .map((a) => (a as { name?: unknown }).name)
        .filter((n): n is string => typeof n === 'string')
    : [];
  return { tag, version, assetNames };
}

async function fetchLatestReadyRelease(
  asset: string,
): Promise<ReadyReleaseResult> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=15`;
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

  const entries = (await response.json()) as Record<string, unknown>[];
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(
      'No releases found. If this is a private repo, set GITHUB_TOKEN.',
    );
  }

  // Parse all non-draft, non-prerelease releases (cap at 10)
  const candidates: ReleaseInfo[] = [];
  for (const entry of entries) {
    if (entry.draft || entry.prerelease) continue;
    const release = parseRelease(entry);
    if (release) candidates.push(release);
    if (candidates.length >= 10) break;
  }

  // Find the highest-versioned release that has the required binary asset
  let best: ReleaseInfo | null = null;
  const skipped: string[] = [];

  for (const candidate of candidates) {
    if (candidate.assetNames.includes(asset)) {
      if (!best || compareVersions(candidate.version, best.version) > 0) {
        best = candidate;
      }
    }
  }

  if (!best) {
    throw new Error(
      `No recent release includes the ${asset} binary. ` +
        `Check https://github.com/${GITHUB_REPO}/releases for details.`,
    );
  }

  // Collect versions that are newer than the best ready release but lack the binary
  for (const candidate of candidates) {
    if (compareVersions(candidate.version, best.version) > 0) {
      skipped.push(candidate.tag);
    }
  }

  // Sort skipped tags by version descending so skipped[0] is the newest
  skipped.sort((a, b) => {
    const va = extractVersion(a) ?? '';
    const vb = extractVersion(b) ?? '';
    return compareVersions(vb, va);
  });

  return { release: best, skipped };
}

async function fetchReleaseByTag(
  asset: string,
  tag: string,
): Promise<ReleaseInfo> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${encodeURIComponent(tag)}`;
  const response = await fetch(url, {
    headers: {
      ...getAuthHeaders(),
      'User-Agent': `tale-cli/${pkg.version}`,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 404) {
    throw new Error(
      `Release ${tag} not found. See https://github.com/${GITHUB_REPO}/releases for available versions.`,
    );
  }
  if (response.status === 403) {
    throw new Error(
      'GitHub API returned 403. This may be rate limiting or an auth issue. ' +
        'Set GITHUB_TOKEN or GH_TOKEN for higher limits.',
    );
  }
  if (!response.ok) {
    throw new Error(
      `Failed to fetch release ${tag}: GitHub API returned ${response.status}.`,
    );
  }

  const entry = (await response.json()) as Record<string, unknown>;
  const release = parseRelease(entry);
  if (!release) {
    throw new Error(`Release ${tag} has no valid version metadata.`);
  }
  if (!release.assetNames.includes(asset)) {
    throw new Error(
      `Release ${tag} does not include the ${asset} binary for this platform. ` +
        `Check https://github.com/${GITHUB_REPO}/releases/tag/${tag} for available assets.`,
    );
  }
  return release;
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

  requireProject();

  const prefix = options.dryRun ? '[DRY-RUN] ' : '';
  const pinnedVersion = options.version;
  logger.header(
    pinnedVersion
      ? `${prefix}Migrating Tale CLI to ${pinnedVersion}`
      : `${prefix}Upgrading Tale CLI`,
  );

  // Phase 1: Resolve target release (latest, or pinned)
  const asset = getAssetName();
  let release: ReleaseInfo;
  let skipped: string[] = [];
  if (pinnedVersion) {
    const tag = normalizeTag(pinnedVersion);
    logger.step(`${prefix}Looking up release ${tag}...`);
    release = await fetchReleaseByTag(asset, tag);
  } else {
    logger.step(`${prefix}Checking for updates...`);
    try {
      ({ release, skipped } = await fetchLatestReadyRelease(asset));
    } catch (err) {
      throw new Error(
        `Could not check for updates. ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  const currentVersion = pkg.version;
  const comparison = compareVersions(release.version, currentVersion);

  logger.info(`Current version: ${currentVersion}`);
  if (pinnedVersion) {
    logger.info(`Target version:  ${release.version}`);
  } else if (skipped.length > 0) {
    logger.info(
      `Latest version:  ${skipped[0].replace(/^v/, '')} (binary not yet available)`,
    );
    logger.info(`Upgrading to:    ${release.version}`);
    logger.warn(
      `Skipping ${skipped.map((t) => t.replace(/^v/, '')).join(', ')} — binary not yet uploaded. ` +
        `Re-run 'tale upgrade' later to pick up newer versions.`,
    );
  } else {
    logger.info(`Latest version:  ${release.version}`);
  }

  if (pinnedVersion && comparison < 0) {
    logger.warn(
      `Downgrading from ${currentVersion} to ${release.version}. ` +
        `Schema changes from the newer version persist in the database — see the rollback notes in the docs.`,
    );
  }

  const isDevBuild = currentVersion.includes('dev');
  // When pinnedVersion, always replace unless the user is already on the exact target.
  const needsBinaryUpgrade = pinnedVersion
    ? comparison !== 0 || isDevBuild || options.force
    : isDevBuild || comparison > 0 || options.force;

  if (!needsBinaryUpgrade) {
    logger.success(
      pinnedVersion
        ? `CLI is already on v${currentVersion}`
        : `CLI is up to date (v${currentVersion})`,
    );
    if (!pinnedVersion && skipped.length > 0) {
      logger.info(
        `Note: ${skipped[0].replace(/^v/, '')} is available but binary not yet uploaded — re-run 'tale upgrade' later.`,
      );
    }
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
  if (skipped.length > 0) {
    logger.info(
      `Note: ${skipped[0].replace(/^v/, '')} binary may become available soon — re-run 'tale upgrade' later.`,
    );
  }

  // Phase 4: Sync project files using the NEW binary.
  // Older releases (pre-0.2.8) don't have `tale upgrade --internal-sync-only`,
  // so when downgrading past that boundary we fall back to running the sync
  // in-process with the current binary's logic.
  logger.blank();
  logger.step('Syncing project files with new version...');

  if (compareVersions(release.version, MIN_VERSION_WITH_INTERNAL_SYNC) < 0) {
    logger.warn(
      `Target v${release.version} predates 'upgrade --internal-sync-only'; running sync in-process instead.`,
    );
    await update({
      force: options.force,
      dryRun: options.dryRun,
      skipHeader: true,
    });
    return;
  }

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

import { chmod, rename, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import pkg from '../../../package.json';
import {
  compareVersions,
  extractVersion,
  sameMinor,
} from '../../utils/compare-versions';
import * as logger from '../../utils/logger';

/**
 * CLI binary self-management: resolve a GitHub release, download + verify its
 * platform binary, and atomically replace the running binary — keeping a
 * backup so the caller can roll back if a *subsequent* step fails.
 *
 * Extracted from the old `tale upgrade` action so both the version-alignment
 * hook ({@link ../version/align}) and `tale update` reuse one implementation.
 * The binary mechanics are unchanged; the only behavioural difference is that
 * {@link installBinary} hands the backup path back to the caller instead of
 * deleting it inline — {@link commitInstall} / {@link rollbackInstall} decide
 * its fate.
 */

const GITHUB_REPO = 'tale-project/tale';

const SUPPORTED_TARGETS: Record<string, string> = {
  'linux-x64': 'tale_linux',
  'linux-arm64': 'tale_linux_arm64',
  'darwin-arm64': 'tale_macos',
  'darwin-x64': 'tale_macos_x64',
  'win32-x64': 'tale_windows.exe',
};

export interface ReleaseInfo {
  tag: string;
  version: string;
  assetNames: string[];
}

export interface ResolvedRelease {
  release: ReleaseInfo;
  /**
   * Tags newer than `release` within the same release line that lack the
   * binary for this platform — i.e. a newer version exists but its binary
   * hasn't been uploaded yet. Empty when a specific version was requested.
   * Newest-first.
   */
  skipped: string[];
  /**
   * Highest released version on a line above the current one (different
   * `major.minor`) when the lookup was line-pinned and one exists. Line
   * upgrades can be breaking, so `tale update` never targets this
   * automatically — it is surfaced so the operator can move explicitly with
   * `--version`. Null when a specific version was requested, on dev builds,
   * or when the current line is the newest.
   */
  newerLine: string | null;
}

/**
 * Opaque handle returned by {@link installBinary}. Carries the path of the
 * backed-up previous binary so the caller can {@link commitInstall} (discard
 * it) or {@link rollbackInstall} (restore it).
 */
export interface InstallHandle {
  installPath: string;
  backupPath: string;
}

export function isDevBuild(version: string = pkg.version): boolean {
  return version.includes('-dev');
}

function normalizeTag(input: string): string {
  const trimmed = input.trim();
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
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

const RELEASES_PAGE_SIZE = 100;
/** Upper bound on paging through /releases — 300 releases ≈ years of history. */
const RELEASES_MAX_PAGES = 3;

async function fetchReleasesPage(
  page: number,
): Promise<Record<string, unknown>[]> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=${RELEASES_PAGE_SIZE}&page=${page}`;
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
  return Array.isArray(entries) ? entries : [];
}

/** Human label for `anchor`'s release line: `0.3.11` → `0.3.x`. */
function lineLabel(anchor: string): string {
  const version = extractVersion(anchor);
  if (!version) return anchor;
  const [major, minor] = version.split('-')[0].split('.');
  return `${major}.${minor}.x`;
}

/**
 * Pick the release to install from the fetched list: the highest-versioned
 * candidate that carries this platform's binary, restricted to `lineAnchor`'s
 * release line (same `major.minor`) unless the anchor is null.
 *
 * `skipped` lists same-line versions above the pick whose binary is missing,
 * newest first. `newerLine` reports the highest version on a line above the
 * anchor's, if any — informational, never targeted.
 *
 * Exported for tests; production goes through {@link resolveRelease}.
 */
export function selectRelease(
  candidates: ReleaseInfo[],
  asset: string,
  lineAnchor: string | null,
): {
  best: ReleaseInfo | null;
  skipped: string[];
  newerLine: string | null;
} {
  const inLine = (version: string) =>
    lineAnchor === null || sameMinor(version, lineAnchor);

  let best: ReleaseInfo | null = null;
  let newerLine: string | null = null;

  for (const candidate of candidates) {
    if (!inLine(candidate.version)) {
      if (
        lineAnchor !== null &&
        compareVersions(candidate.version, lineAnchor) > 0 &&
        (newerLine === null ||
          compareVersions(candidate.version, newerLine) > 0)
      ) {
        newerLine = candidate.version;
      }
      continue;
    }
    if (!candidate.assetNames.includes(asset)) continue;
    if (!best || compareVersions(candidate.version, best.version) > 0) {
      best = candidate;
    }
  }

  // Collect same-line versions newer than the pick but lacking the binary
  const skipped: string[] = [];
  if (best) {
    for (const candidate of candidates) {
      if (!inLine(candidate.version)) continue;
      if (compareVersions(candidate.version, best.version) > 0) {
        skipped.push(candidate.tag);
      }
    }
  }

  // Sort skipped tags by version descending so skipped[0] is the newest
  skipped.sort((a, b) => {
    const va = extractVersion(a) ?? '';
    const vb = extractVersion(b) ?? '';
    return compareVersions(vb, va);
  });

  return { best, skipped, newerLine };
}

async function fetchLatestReadyRelease(
  asset: string,
  lineAnchor: string | null,
): Promise<ResolvedRelease> {
  const candidates: ReleaseInfo[] = [];
  let sawAnyRelease = false;

  // Page until the pinned line yields an installable release — once newer
  // lines accumulate releases, the current line's latest falls off the
  // first page.
  for (let page = 1; page <= RELEASES_MAX_PAGES; page++) {
    let entries: Record<string, unknown>[];
    try {
      entries = await fetchReleasesPage(page);
    } catch (err) {
      if (page === 1) throw err;
      // Later pages are best-effort: select from what already loaded.
      logger.debug(
        `stopping release pagination at page ${page}: ${String(err)}`,
      );
      break;
    }
    if (entries.length > 0) sawAnyRelease = true;

    for (const entry of entries) {
      if (entry.draft || entry.prerelease) continue;
      const release = parseRelease(entry);
      if (release) candidates.push(release);
    }

    const { best } = selectRelease(candidates, asset, lineAnchor);
    if (best || entries.length < RELEASES_PAGE_SIZE) break;
  }

  if (!sawAnyRelease) {
    throw new Error(
      'No releases found. If this is a private repo, set GITHUB_TOKEN.',
    );
  }

  const { best, skipped, newerLine } = selectRelease(
    candidates,
    asset,
    lineAnchor,
  );

  if (!best) {
    const base =
      lineAnchor === null
        ? `No recent release includes the ${asset} binary.`
        : `No ${lineLabel(lineAnchor)} release includes the ${asset} binary.`;
    const lineHint =
      lineAnchor !== null && newerLine !== null
        ? ` A newer release line exists (v${newerLine}) — 'tale update' stays ` +
          `within ${lineLabel(lineAnchor)}; move lines explicitly with ` +
          `'tale update --version ${newerLine}'.`
        : '';
    throw new Error(
      `${base}${lineHint} ` +
        `Check https://github.com/${GITHUB_REPO}/releases for details.`,
    );
  }

  return { release: best, skipped, newerLine };
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

/** The on-disk path of the running `tale` binary — what install replaced and uninstall removes. */
export function getBinaryPath(): string {
  return process.execPath;
}

/**
 * Resolve the release to install: a specific version when `version` is set,
 * otherwise the latest release — within the running binary's release line
 * (same `major.minor`) — whose platform binary is uploaded.
 *
 * Line upgrades (e.g. 0.3.x → 0.4.0) can be breaking, so they never happen
 * implicitly: moving lines requires an explicit `version`. Dev builds carry
 * a placeholder version with no released line and keep resolving the
 * absolute latest.
 */
export async function resolveRelease(opts: {
  version?: string;
}): Promise<ResolvedRelease> {
  const asset = getAssetName();
  if (opts.version) {
    const release = await fetchReleaseByTag(asset, normalizeTag(opts.version));
    return { release, skipped: [], newerLine: null };
  }
  const lineAnchor = isDevBuild() ? null : pkg.version;
  return fetchLatestReadyRelease(asset, lineAnchor);
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

/**
 * Replace the binary at `installPath` with `tmpPath`, backing up the current
 * binary to `${installPath}.bak`. Returns the backup path — the caller owns it
 * ({@link commitInstall} / {@link rollbackInstall}). Throws (and self-restores
 * the backup) if the move fails.
 */
async function replaceBinary(
  tmpPath: string,
  installPath: string,
): Promise<string> {
  const bakPath = `${installPath}.bak`;

  // Back up current binary (instant rename on same filesystem)
  try {
    await rename(installPath, bakPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(
        `Permission denied backing up ${installPath}. Try: sudo tale update`,
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
    // Move failed — restore the backup so the running binary is intact.
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

  return bakPath;
}

/**
 * Windows variant: rename the running exe out of the way (allowed on Windows)
 * and move the new binary into place. Returns the `.old` backup path.
 */
function replaceBinaryWindows(tmpPath: string, installPath: string): string {
  // `ren` takes a bare destination NAME (same directory), so the backup lands
  // at `${dir}\\${oldName}` — derive everything from installPath's basename so
  // the returned handle, the restore-on-failure rename, and commitInstall /
  // rollbackInstall all reference the SAME real file regardless of the binary's
  // name. (A prior `${installPath}.old` mismatched the literal `tale.old.exe`
  // it actually created, silently breaking rollback.)
  const base = basename(installPath);
  const oldName = `${base}.old`;
  const oldPath = join(dirname(installPath), oldName);

  // Clean up a stale backup from a previous run if present
  try {
    Bun.spawnSync(['cmd', '/c', 'del', '/f', oldPath], { stdout: 'pipe' });
  } catch {
    // ignore — best-effort cleanup of a leftover backup
  }

  // Windows allows renaming a running exe
  const renameOld = Bun.spawnSync(['cmd', '/c', 'ren', installPath, oldName], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
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
    // Restore the previous binary (rename the backup back to the original name).
    Bun.spawnSync(['cmd', '/c', 'ren', oldPath, base], { stdout: 'pipe' });
    throw new Error(`Failed to place new binary. Previous version restored.`);
  }

  return oldPath;
}

/**
 * Download, verify, and install the given release over the running binary.
 * Returns an {@link InstallHandle} whose backup the caller must dispose of via
 * {@link commitInstall} (on success) or {@link rollbackInstall} (on failure).
 */
export async function installBinary(
  release: ReleaseInfo,
): Promise<InstallHandle> {
  const asset = getAssetName();
  const installPath = getBinaryPath();
  const tmpPath = join(tmpdir(), `tale-update-${Date.now()}`);

  try {
    await downloadBinary(release.tag, asset, tmpPath);
    await verifyBinary(tmpPath, release.version);
  } catch (err) {
    await unlink(tmpPath).catch((e: unknown) => {
      console.warn('[tale] failed to clean up temp download:', e);
    });
    throw err;
  }

  const backupPath =
    process.platform === 'win32'
      ? replaceBinaryWindows(tmpPath, installPath)
      : await replaceBinary(tmpPath, installPath);

  return { installPath, backupPath };
}

/** Discard the backup after a successful install (best-effort). */
export async function commitInstall(handle: InstallHandle): Promise<void> {
  if (process.platform === 'win32') {
    Bun.spawnSync(['cmd', '/c', 'del', '/f', handle.backupPath], {
      stdout: 'pipe',
    });
    return;
  }
  await unlink(handle.backupPath).catch((e: unknown) => {
    console.warn('[tale] failed to remove install backup:', e);
  });
}

/** Restore the backed-up previous binary, undoing an {@link installBinary}. */
export async function rollbackInstall(handle: InstallHandle): Promise<void> {
  if (process.platform === 'win32') {
    Bun.spawnSync(
      ['cmd', '/c', 'move', '/y', handle.backupPath, handle.installPath],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    return;
  }
  await rename(handle.backupPath, handle.installPath);
}

/**
 * Delete the `tale` binary at `installPath` (defaults to the running binary) —
 * the inverse of {@link installBinary}, used by `tale uninstall`.
 *
 * Unix: `unlink` works even on the running binary (the inode lives until this
 * process exits). A permission error retries under `sudo rm` — the same
 * escalation {@link replaceBinary} uses for the install path. An already-gone
 * binary is a no-op.
 *
 * Windows can't delete a running `.exe`, so we hand the deletion to a detached
 * `cmd` that waits for this process to exit, then deletes the file. Best-effort:
 * removal completes a moment after the command returns.
 */
export async function removeBinary(
  installPath: string = getBinaryPath(),
): Promise<void> {
  if (process.platform === 'win32') {
    // Detached so it outlives this process; the short ping is a portable
    // "sleep" that lets the running .exe release before `del` runs.
    Bun.spawn(
      ['cmd', '/c', `ping 127.0.0.1 -n 2 >nul & del /f /q "${installPath}"`],
      { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
    );
    logger.info(
      'Windows cannot delete a running binary — it will be removed once this process exits.',
    );
    return;
  }

  try {
    await unlink(installPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return; // already gone — nothing to do
    if (code === 'EACCES' || code === 'EPERM') {
      logger.info('Requesting sudo to remove binary...');
      const sudoResult = Bun.spawnSync(['sudo', 'rm', '-f', installPath], {
        stdout: 'inherit',
        stderr: 'inherit',
        stdin: 'inherit',
      });
      if (sudoResult.exitCode !== 0) {
        throw new Error(
          `Permission denied removing ${installPath}. Try: sudo tale uninstall`,
          { cause: err },
        );
      }
      return;
    }
    throw err;
  }
}

/**
 * Best-effort cleanup of leftover update backups next to the binary —
 * `${installPath}.bak` (Unix) and `${dir}/${basename}.old` (Windows). A missing
 * backup is the common case and is silently ignored.
 */
export async function removeBinaryBackups(
  installPath: string = getBinaryPath(),
): Promise<void> {
  const backups =
    process.platform === 'win32'
      ? [join(dirname(installPath), `${basename(installPath)}.old`)]
      : [`${installPath}.bak`];

  for (const backup of backups) {
    await unlink(backup).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') {
        logger.warn(`Failed to remove backup ${backup}: ${err.message}`);
      }
    });
  }
}

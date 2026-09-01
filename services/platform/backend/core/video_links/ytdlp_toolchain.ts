'use node';

/**
 * Self-provisioning toolchain for the LIVE YouTube-ingest test
 * (`ytdlp_live.test.ts`). Production bakes yt-dlp + deno + ffmpeg + the bgutil
 * PO-token plugin into the platform image (`services/platform/Dockerfile`); this
 * module reproduces that set ON DEMAND so the live test runs on a bare laptop
 * or CI runner without a bespoke install step.
 *
 * What it guarantees — downloading only what's missing into a per-user cache
 * (`~/.cache/tale-video-toolchain/`, override `TALE_VIDEO_TOOLCHAIN_DIR`):
 *   - yt-dlp: platform standalone binary → `bin/yt-dlp`. Skipped when yt-dlp is
 *     already on a pinned system PATH dir (`/usr/local/bin`|`/usr/bin`), i.e.
 *     the production image, where `runYtdlp` finds it with no override.
 *   - deno: yt-dlp's JS-challenge runtime (n-signature solver, yt-dlp ≥
 *     2025.11) → `bin/deno`. Same skip rule.
 *   - ffmpeg: SYSTEM-FIRST — resolved via `which` over the FULL inherited PATH
 *     (so Homebrew's `/opt/homebrew/bin` counts), installed via brew/apt only
 *     when absent. Returned as an absolute path because yt-dlp receives it
 *     through `--ffmpeg-location`, which is PATH-independent.
 *   - bgutil: PO-token-provider plugin → `plugins/bgutil/yt_dlp_plugins/`
 *     (nested — yt-dlp `--plugin-dirs` does `iterdir()` then looks for
 *     `yt_dlp_plugins/` under each child). Cheap; only exercised when a
 *     provider URL is reachable (datacenter IPs), so a residential host that
 *     never calls it can't be broken by a partial plugin.
 *
 * The caller (`ytdlp_live.test.ts`'s `beforeAll`) feeds the returned dirs to
 * `ytdlp.ts` via `VIDEO_INGEST_BIN_DIR` (prepended to the sandboxed spawn PATH),
 * `VIDEO_INGEST_FFMPEG_LOCATION`, and `VIDEO_INGEST_YTDLP_PLUGIN_DIRS`.
 *
 * `'use node'`: this file lives under `convex/` (so the convex bundler analyses
 * it) and uses `node:child_process`/`node:fs` — the same runtime pin as
 * `ytdlp.ts`. It is imported only by the gated live test, never by a deployed
 * Convex function.
 */

import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { arch, homedir, platform } from 'node:os';
import { join } from 'node:path';

/**
 * Directories the yt-dlp/ffmpeg spawn PATH is pinned to in production
 * (`ytdlp.ts:buildSpawnPath`). A binary already present in one of these needs
 * no download — the sandboxed child finds it without `VIDEO_INGEST_BIN_DIR`.
 */
const PINNED_SYSTEM_BIN_DIRS = ['/usr/local/bin', '/usr/bin'] as const;

/**
 * bgutil PO-token provider plugin version. Pinned to match the `bgutil` service
 * container in `.github/workflows/checks.yml` and the Dockerfile's baked copy —
 * plugin and provider must agree on the protocol version.
 */
const BGUTIL_POT_VERSION = '1.3.1';

/**
 * Named child under `--plugin-dirs` where the bgutil zip is expanded.
 * yt-dlp's `candidate_plugin_paths` does `Path(dir).iterdir()` then looks for
 * `yt_dlp_plugins/` under each child — so the zip (which already contains
 * `yt_dlp_plugins/`) must land in `<plugin-dirs>/bgutil/`, not directly in
 * `<plugin-dirs>/`. Must stay in lockstep with `services/platform/Dockerfile`.
 */
export const BGUTIL_PLUGIN_NEST_DIR = 'bgutil';

/** Absolute install dir for the bgutil plugin package under a `--plugin-dirs` root. */
export function bgutilPluginInstallDir(pluginDirsRoot: string): string {
  return join(pluginDirsRoot, BGUTIL_PLUGIN_NEST_DIR);
}

interface VideoToolchain {
  /**
   * `bin/` holding the (possibly downloaded) yt-dlp + deno. Prepended to the
   * sandboxed spawn PATH via `VIDEO_INGEST_BIN_DIR`.
   */
  binDir: string;
  /** Absolute ffmpeg path — passed via `--ffmpeg-location`, so PATH-independent. */
  ffmpegLocation: string;
  /** `plugins/` holding the bgutil plugin — set as `VIDEO_INGEST_YTDLP_PLUGIN_DIRS`. */
  pluginDir: string;
}

// Memoized module-level promise: `provisionToolchain` runs at most once per
// process, and its on-disk cache makes repeated processes (test files, reruns)
// cheap too. A rejection is intentionally cached — a broken host fails fast and
// identically rather than re-attempting slow downloads on every call.
let cachedToolchain: Promise<VideoToolchain> | null = null;

/**
 * Ensure yt-dlp + deno + ffmpeg + the bgutil plugin are available for the live
 * ingest test, downloading whatever is missing. Idempotent (every step no-ops
 * when its output already exists) and memoized.
 */
export async function ensureVideoToolchain(): Promise<VideoToolchain> {
  cachedToolchain ??= provisionToolchain();
  return cachedToolchain;
}

async function provisionToolchain(): Promise<VideoToolchain> {
  const cacheDir =
    process.env.TALE_VIDEO_TOOLCHAIN_DIR?.trim() ||
    join(homedir(), '.cache', 'tale-video-toolchain');
  const binDir = join(cacheDir, 'bin');
  const pluginDir = join(cacheDir, 'plugins');
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(pluginDir, { recursive: true });

  await ensureYtdlp(binDir);
  await ensureDeno(binDir);
  const ffmpegLocation = await ensureFfmpeg();
  await ensureBgutilPlugin(pluginDir);

  return { binDir, ffmpegLocation, pluginDir };
}

/**
 * True when `bin` already sits on a pinned production PATH dir, so the
 * sandboxed child resolves it with no `VIDEO_INGEST_BIN_DIR` override.
 */
function isOnPinnedSystemPath(bin: string): boolean {
  return PINNED_SYSTEM_BIN_DIRS.some((dir) => existsSync(join(dir, bin)));
}

/** yt-dlp standalone-build asset name for this host (yt-dlp's own naming). */
function ytdlpAsset(): string {
  const p = platform();
  const a = arch();
  // The macOS build is a universal binary (arm64 + x64), so arch is irrelevant.
  if (p === 'darwin') return 'yt-dlp_macos';
  if (p === 'linux' && a === 'x64') return 'yt-dlp_linux';
  if (p === 'linux' && a === 'arm64') return 'yt-dlp_linux_aarch64';
  throw new Error(`[video-toolchain] no yt-dlp standalone build for ${p}/${a}`);
}

async function ensureYtdlp(binDir: string): Promise<void> {
  const cached = join(binDir, 'yt-dlp');
  if (isOnPinnedSystemPath('yt-dlp') || existsSync(cached)) return;
  console.info('[video-toolchain] downloading yt-dlp…');
  await downloadTo(
    `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlpAsset()}`,
    cached,
  );
  await fs.chmod(cached, 0o755);
}

/** Deno release triple for this host (deno's own release naming). */
function denoTriple(): string {
  const p = platform();
  const a = arch();
  if (p === 'darwin' && a === 'arm64') return 'aarch64-apple-darwin';
  if (p === 'darwin' && a === 'x64') return 'x86_64-apple-darwin';
  if (p === 'linux' && a === 'x64') return 'x86_64-unknown-linux-gnu';
  if (p === 'linux' && a === 'arm64') return 'aarch64-unknown-linux-gnu';
  throw new Error(`[video-toolchain] no deno build for ${p}/${a}`);
}

async function ensureDeno(binDir: string): Promise<void> {
  const cached = join(binDir, 'deno');
  if (isOnPinnedSystemPath('deno') || existsSync(cached)) return;
  console.info('[video-toolchain] downloading deno…');
  // The deno release ships a single `deno` binary inside a zip.
  const zip = join(binDir, 'deno.zip');
  await downloadTo(
    `https://github.com/denoland/deno/releases/latest/download/deno-${denoTriple()}.zip`,
    zip,
  );
  await unzipInto(zip, binDir);
  await fs.rm(zip, { force: true });
  await fs.chmod(cached, 0o755);
}

/**
 * Resolve an absolute ffmpeg path (system-first). ffmpeg is passed to yt-dlp via
 * `--ffmpeg-location`, so it need NOT sit on the pinned spawn PATH — a Homebrew
 * `/opt/homebrew/bin/ffmpeg` is fine. If absent, install it with the platform
 * package manager (brew on macOS, apt on Debian/Ubuntu, best-effort) and
 * re-resolve. Throws a clear, actionable error if it still can't be found.
 */
async function ensureFfmpeg(): Promise<string> {
  const found = await which('ffmpeg');
  if (found) return found;

  if (platform() === 'darwin' && (await which('brew'))) {
    console.info('[video-toolchain] installing ffmpeg via Homebrew…');
    await run('brew', ['install', 'ffmpeg']);
  } else if (platform() === 'linux' && (await which('apt-get'))) {
    console.info('[video-toolchain] installing ffmpeg via apt-get…');
    // Best-effort: the runner may lack sudo or network. A failure just surfaces
    // as the "still missing" error below, with full context for the operator.
    try {
      await run('sudo', ['apt-get', 'install', '-y', 'ffmpeg']);
    } catch (err) {
      console.warn(
        '[video-toolchain] apt-get install ffmpeg failed (best-effort):',
        err instanceof Error ? err.message : err,
      );
    }
  }

  const reResolved = await which('ffmpeg');
  if (!reResolved) {
    throw new Error(
      '[video-toolchain] ffmpeg not found and could not be auto-installed. ' +
        'Install it manually (macOS: `brew install ffmpeg`; Debian/Ubuntu: ' +
        '`apt-get install ffmpeg`) and re-run.',
    );
  }
  return reResolved;
}

/**
 * Download + unzip the bgutil PO-token-provider plugin into
 * `pluginDir/bgutil/`. The zip expands to `yt_dlp_plugins/`; nesting under the
 * named child is required for yt-dlp to discover it via `--plugin-dirs`
 * (see `BGUTIL_PLUGIN_NEST_DIR`). Presence of that nested package is the
 * idempotency guard.
 */
async function ensureBgutilPlugin(pluginDir: string): Promise<void> {
  const installDir = bgutilPluginInstallDir(pluginDir);
  if (existsSync(join(installDir, 'yt_dlp_plugins'))) return;
  console.info('[video-toolchain] downloading bgutil yt-dlp plugin…');
  await fs.mkdir(installDir, { recursive: true });
  const zip = join(pluginDir, 'bgutil-ytdlp-pot-provider.zip');
  await downloadTo(
    `https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${BGUTIL_POT_VERSION}/bgutil-ytdlp-pot-provider.zip`,
    zip,
  );
  await unzipInto(zip, installDir);
  await fs.rm(zip, { force: true });
}

/**
 * Stream a URL to `dest`. `fetch` follows redirects, so the GitHub
 * `releases/latest/download/…` shape (302 → CDN) works directly. The whole body
 * is buffered in memory — every asset here is well under ~50 MB.
 */
async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `[video-toolchain] download failed (${res.status} ${res.statusText}): ${url}`,
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  await fs.writeFile(dest, bytes);
}

/**
 * Unzip `zip` into `destDir` via the system `unzip` (present on macOS and the
 * GitHub Ubuntu runner). `-o` overwrites so a re-run over a warm cache never
 * blocks on a prompt; `-q` keeps the test output quiet.
 */
async function unzipInto(zip: string, destDir: string): Promise<void> {
  await run('unzip', ['-o', '-q', zip, '-d', destDir]);
}

/**
 * Resolve `bin` to an absolute path via the system `which`, searching the FULL
 * inherited PATH (unlike the sandboxed yt-dlp spawn) so a Homebrew/apt ffmpeg is
 * discoverable. Returns null when not found — never throws.
 */
async function which(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('which', [bin], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    // ENOENT (no `which` binary) or any spawn error → treat as "not found".
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      const first = out.trim().split('\n')[0]?.trim();
      resolve(code === 0 && first ? first : null);
    });
  });
}

/**
 * Spawn `cmd` and resolve on exit 0, rejecting otherwise. stdout/stderr are
 * inherited so a slow `brew install` streams progress into the test output.
 */
async function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `[video-toolchain] '${cmd} ${args.join(' ')}' exited ${code}`,
          ),
        );
    });
  });
}

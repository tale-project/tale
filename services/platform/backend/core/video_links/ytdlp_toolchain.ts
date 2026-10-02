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
 * Every stage is BOUNDED (`VIDEO_TOOLCHAIN_DEADLINES`): neither `fetch` nor a
 * spawned child has a deadline of its own, and a caller's timeout (a Vitest
 * hook's) rejects without cancelling anything. A stall therefore aborts its
 * download or stops the child it started — with what that child started, in
 * its process group and (through `/proc`) outside it — and rejects with a
 * `VideoToolchainError` naming the stage, its elapsed time and its deadline,
 * plus whatever the cleanup could not stop.
 *
 * `'use node'`: this file lives under `convex/` (so the convex bundler analyses
 * it) and uses `node:child_process`/`node:fs` — the same runtime pin as
 * `ytdlp.ts`. It is imported only by the gated live test, never by a deployed
 * Convex function.
 */

import { spawn, type StdioOptions } from 'node:child_process';
import { existsSync, promises as fs, readdirSync, readFileSync } from 'node:fs';
import { arch, homedir, platform } from 'node:os';
import { join } from 'node:path';

/**
 * Directories the yt-dlp/ffmpeg spawn PATH is pinned to in production
 * (`ytdlp.ts:buildSpawnPath`). A binary already present in one of these needs
 * no download — the sandboxed child finds it without `VIDEO_INGEST_BIN_DIR`.
 */
const PINNED_SYSTEM_BIN_DIRS = ['/usr/local/bin', '/usr/bin'] as const;

/**
 * Wall-clock bounds for one provisioning run. Each stage gets its own deadline,
 * capped by what is left of `totalMs`. `totalMs` (plus the kill grace) stays
 * below the live test's hook timeout, so a stall fails HERE, naming its stage,
 * instead of as an anonymous "Hook timed out" that leaves the child running —
 * which is how a stalled `apt-get` once held the required Unit job for ten
 * minutes (#4073). The install bound is wide on purpose: a slow but moving
 * apt mirror is common on hosted runners.
 */
export const VIDEO_TOOLCHAIN_DEADLINES = {
  totalMs: 540_000,
  /** `fetch` until the response headers arrive. */
  downloadResponseMs: 30_000,
  /** Reading one asset's body (each is well under ~50 MB). */
  downloadBodyMs: 120_000,
  /** One `which` lookup. */
  lookupMs: 10_000,
  /** One `unzip`. */
  unzipMs: 60_000,
  /** `brew install ffmpeg` / `apt-get install ffmpeg`. */
  packageInstallMs: 420_000,
  /** SIGTERM → SIGKILL grace for a stopped child's process group. */
  killGraceMs: 5_000,
};

type VideoToolchainDeadlines = typeof VIDEO_TOOLCHAIN_DEADLINES;

/** A provisioning stage failed; `stage` names it (e.g. `yt-dlp download body`). */
export class VideoToolchainError extends Error {
  readonly stage: string;

  constructor(stage: string, detail: string, options?: ErrorOptions) {
    super(`[video-toolchain] ${stage}: ${detail}`, options);
    this.name = 'VideoToolchainError';
    this.stage = stage;
  }
}

/** One stage's effective bound: its own deadline, or the rest of the run's. */
interface StageDeadline {
  ms: number;
  /** Set when the remaining provisioning budget, not the stage's own bound, set `ms`. */
  budgetMs?: number;
}

/**
 * Bounds every stage of one provisioning run by its own deadline and the run's
 * total. Elapsed time is monotonic (`performance.now()`), so a wall-clock step
 * — an NTP correction, a laptop waking up — neither spends nor grants budget.
 */
export class ProvisioningClock {
  readonly deadlines: VideoToolchainDeadlines;
  private readonly startedAt = performance.now();

  constructor(deadlines: VideoToolchainDeadlines) {
    this.deadlines = deadlines;
  }

  stage(ms: number): StageDeadline {
    const left = Math.max(
      0,
      Math.floor(this.deadlines.totalMs - (performance.now() - this.startedAt)),
    );
    return left < ms ? { ms: left, budgetMs: this.deadlines.totalMs } : { ms };
  }
}

/** `startedAt` is a `performance.now()` reading. */
function timeoutDetail(deadline: StageDeadline, startedAt: number): string {
  const bound =
    deadline.budgetMs === undefined
      ? `deadline ${deadline.ms} ms`
      : `the rest of the ${deadline.budgetMs} ms provisioning budget, ${deadline.ms} ms`;
  return `timed out after ${Math.round(performance.now() - startedAt)} ms (${bound})`;
}

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

/**
 * One un-memoized provisioning run. `ensureVideoToolchain` is the entry point;
 * this seam exists so a test can point it at a scratch cache with short
 * deadlines.
 */
export async function provisionToolchain(
  options: {
    cacheDir?: string;
    deadlines?: Partial<VideoToolchainDeadlines>;
  } = {},
): Promise<VideoToolchain> {
  const clock = new ProvisioningClock({
    ...VIDEO_TOOLCHAIN_DEADLINES,
    ...options.deadlines,
  });
  const cacheDir =
    options.cacheDir ??
    (process.env.TALE_VIDEO_TOOLCHAIN_DIR?.trim() ||
      join(homedir(), '.cache', 'tale-video-toolchain'));
  const binDir = join(cacheDir, 'bin');
  const pluginDir = join(cacheDir, 'plugins');
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(pluginDir, { recursive: true });

  await ensureYtdlp(binDir, clock);
  await ensureDeno(binDir, clock);
  const ffmpegLocation = await ensureFfmpeg(clock);
  await ensureBgutilPlugin(pluginDir, clock);

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

async function ensureYtdlp(
  binDir: string,
  clock: ProvisioningClock,
): Promise<void> {
  const cached = join(binDir, 'yt-dlp');
  if (isOnPinnedSystemPath('yt-dlp') || existsSync(cached)) return;
  console.info('[video-toolchain] downloading yt-dlp…');
  await downloadTo(
    'yt-dlp download',
    `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlpAsset()}`,
    cached,
    clock,
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

async function ensureDeno(
  binDir: string,
  clock: ProvisioningClock,
): Promise<void> {
  const cached = join(binDir, 'deno');
  if (isOnPinnedSystemPath('deno') || existsSync(cached)) return;
  console.info('[video-toolchain] downloading deno…');
  // The deno release ships a single `deno` binary inside a zip.
  const zip = join(binDir, 'deno.zip');
  await downloadTo(
    'deno download',
    `https://github.com/denoland/deno/releases/latest/download/deno-${denoTriple()}.zip`,
    zip,
    clock,
  );
  await unzipInto('deno unzip', zip, binDir, clock);
  await fs.rm(zip, { force: true });
  await fs.chmod(cached, 0o755);
}

/**
 * Resolve an absolute ffmpeg path (system-first). ffmpeg is passed to yt-dlp via
 * `--ffmpeg-location`, so it need NOT sit on the pinned spawn PATH — a Homebrew
 * `/opt/homebrew/bin/ffmpeg` is fine. If absent, install it with the platform
 * package manager (brew on macOS, apt on Debian/Ubuntu, best-effort) and
 * re-resolve. Throws a clear, actionable error if it still can't be found,
 * carrying the install stage's own failure (a timeout names its elapsed time).
 */
async function ensureFfmpeg(clock: ProvisioningClock): Promise<string> {
  const found = await which('ffmpeg', clock);
  if (found) return found;

  const install = clock.deadlines.packageInstallMs;
  let installFailure: unknown;
  if (platform() === 'darwin' && (await which('brew', clock))) {
    console.info('[video-toolchain] installing ffmpeg via Homebrew…');
    await run(
      'ffmpeg install (brew)',
      'brew',
      ['install', 'ffmpeg'],
      clock.stage(install),
      clock,
    );
  } else if (platform() === 'linux' && (await which('apt-get', clock))) {
    console.info('[video-toolchain] installing ffmpeg via apt-get…');
    // Best-effort: the runner may lack sudo or network. A failure just surfaces
    // as the "still missing" error below, with full context for the operator.
    // `sudo -n`: a password prompt is a wait with no deadline, and the bounded
    // child runs without a terminal — it fails at once instead.
    try {
      await run(
        'ffmpeg install (apt-get)',
        'sudo',
        ['-n', 'apt-get', 'install', '-y', 'ffmpeg'],
        clock.stage(install),
        clock,
      );
    } catch (err) {
      installFailure = err;
      console.warn(
        '[video-toolchain] apt-get install ffmpeg failed (best-effort):',
        err instanceof Error ? err.message : err,
      );
    }
  }

  const reResolved = await which('ffmpeg', clock);
  if (!reResolved) {
    const cause =
      installFailure instanceof Error ? ` (${installFailure.message})` : '';
    throw new Error(
      '[video-toolchain] ffmpeg not found and could not be auto-installed' +
        `${cause}. Install it manually (macOS: \`brew install ffmpeg\`; ` +
        'Debian/Ubuntu: `apt-get install ffmpeg`) and re-run.',
      { cause: installFailure },
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
async function ensureBgutilPlugin(
  pluginDir: string,
  clock: ProvisioningClock,
): Promise<void> {
  const installDir = bgutilPluginInstallDir(pluginDir);
  if (existsSync(join(installDir, 'yt_dlp_plugins'))) return;
  console.info('[video-toolchain] downloading bgutil yt-dlp plugin…');
  await fs.mkdir(installDir, { recursive: true });
  const zip = join(pluginDir, 'bgutil-ytdlp-pot-provider.zip');
  await downloadTo(
    'bgutil plugin download',
    `https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${BGUTIL_POT_VERSION}/bgutil-ytdlp-pot-provider.zip`,
    zip,
    clock,
  );
  await unzipInto('bgutil plugin unzip', zip, installDir, clock);
  await fs.rm(zip, { force: true });
}

/**
 * Stream a URL to `dest`. `fetch` follows redirects, so the GitHub
 * `releases/latest/download/…` shape (302 → CDN) works directly. The whole body
 * is buffered in memory — every asset here is well under ~50 MB.
 *
 * Bounded in two stages on ONE `AbortController`, because the signal handed to
 * `fetch` governs the body read too: `<stage> response` until the headers
 * arrive, then `<stage> body`. Expiry aborts the request with a
 * `VideoToolchainError` naming the stage.
 */
export async function downloadTo(
  stage: string,
  url: string,
  dest: string,
  clock: ProvisioningClock,
): Promise<void> {
  const controller = new AbortController();
  const arm = (phase: string, deadline: StageDeadline): NodeJS.Timeout => {
    const startedAt = performance.now();
    return setTimeout(
      () =>
        controller.abort(
          new VideoToolchainError(phase, timeoutDetail(deadline, startedAt)),
        ),
      deadline.ms,
    );
  };
  let timer = arm(
    `${stage} response`,
    clock.stage(clock.deadlines.downloadResponseMs),
  );
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      await res.body?.cancel();
      throw new VideoToolchainError(
        stage,
        `download failed (${res.status} ${res.statusText}): ${url}`,
      );
    }
    timer = arm(`${stage} body`, clock.stage(clock.deadlines.downloadBodyMs));
    const bytes = new Uint8Array(await res.arrayBuffer());
    await fs.writeFile(dest, bytes);
  } catch (err) {
    // An abort surfaces as whatever the runtime wraps it in; the reason is ours.
    if (controller.signal.reason instanceof VideoToolchainError) {
      throw controller.signal.reason;
    }
    if (err instanceof VideoToolchainError) throw err;
    // A network or write failure (DNS, reset, ENOSPC) names its stage too.
    throw new VideoToolchainError(
      stage,
      `download failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Unzip `zip` into `destDir` via the system `unzip` (present on macOS and the
 * GitHub Ubuntu runner). `-o` overwrites so a re-run over a warm cache never
 * blocks on a prompt; `-q` keeps the test output quiet.
 */
async function unzipInto(
  stage: string,
  zip: string,
  destDir: string,
  clock: ProvisioningClock,
): Promise<void> {
  await run(
    stage,
    'unzip',
    ['-o', '-q', zip, '-d', destDir],
    clock.stage(clock.deadlines.unzipMs),
    clock,
  );
}

/**
 * Resolve `bin` to an absolute path via the system `which`, searching the FULL
 * inherited PATH (unlike the sandboxed yt-dlp spawn) so a Homebrew/apt ffmpeg is
 * discoverable. Returns null when not found (or when `which` itself is missing);
 * rejects only when the lookup overruns its deadline.
 */
async function which(
  bin: string,
  clock: ProvisioningClock,
): Promise<string | null> {
  const result = await spawnBounded(
    `${bin} lookup`,
    'which',
    [bin],
    clock.stage(clock.deadlines.lookupMs),
    clock.deadlines.killGraceMs,
    true,
  );
  if (result.spawnError) return null;
  const first = result.stdout.trim().split('\n')[0]?.trim();
  return result.code === 0 && first ? first : null;
}

/**
 * Spawn `cmd` and resolve on exit 0, rejecting otherwise. stdout/stderr are
 * inherited so a slow `brew install` streams progress into the test output.
 */
export async function run(
  stage: string,
  cmd: string,
  args: string[],
  deadline: StageDeadline,
  clock: ProvisioningClock,
): Promise<void> {
  const result = await spawnBounded(
    stage,
    cmd,
    args,
    deadline,
    clock.deadlines.killGraceMs,
    false,
  );
  if (result.spawnError) {
    throw new VideoToolchainError(
      stage,
      `could not start '${cmd}': ${result.spawnError.message}`,
      { cause: result.spawnError },
    );
  }
  if (result.code !== 0) {
    const how =
      result.code === null
        ? `was killed by ${result.signal}`
        : `exited ${result.code}`;
    throw new VideoToolchainError(stage, `'${cmd} ${args.join(' ')}' ${how}`);
  }
}

interface BoundedChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  /** Set when the child never started (e.g. ENOENT). */
  spawnError?: Error;
}

/** A process as `/proc/<pid>/stat` shows it. */
interface ProcEntry {
  pid: number;
  /** Its executable's name (15 characters at most), never its arguments. */
  comm: string;
  ppid: number;
  pgid: number;
  sid: number;
  /** Start time since boot: a recycled pid never repeats it. */
  startTime: string;
  zombie: boolean;
}

function errorCode(err: unknown): unknown {
  return err instanceof Error && 'code' in err ? err.code : undefined;
}

/** `/proc/<pid>/stat`, or undefined once that process is gone. */
function readProcEntry(pid: number | string): ProcEntry | undefined {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch (err) {
    // ENOENT/ESRCH: it ended between the listing and this read.
    const code = errorCode(err);
    if (code !== 'ENOENT' && code !== 'ESRCH') {
      console.warn(
        `[video-toolchain] could not read /proc/${pid}/stat:`,
        err instanceof Error ? err.message : String(err),
      );
    }
    return undefined;
  }
  // `comm` is parenthesised and may itself hold spaces or parentheses.
  const close = stat.lastIndexOf(')');
  const fields = stat.slice(close + 2).split(' ');
  return {
    pid: Number(stat.slice(0, stat.indexOf(' '))),
    comm: stat.slice(stat.indexOf('(') + 1, close),
    zombie: fields[0] === 'Z',
    ppid: Number(fields[1]),
    pgid: Number(fields[2]),
    sid: Number(fields[3]),
    startTime: fields[19] ?? '',
  };
}

/** True while `entry`'s pid still names that same, unreaped process. */
function stillRunning(entry: ProcEntry): boolean {
  const now = readProcEntry(entry.pid);
  return now !== undefined && !now.zombie && now.startTime === entry.startTime;
}

/**
 * What `pid` started that a signal to its process group misses: members of
 * its session in another group (`setpgid`: GNU `timeout`, a job-control
 * shell) and descendants that left the session too (`setsid`; sudo's pty
 * monitor) — found in `/proc` by session and parentage, never by name. Read
 * only while `pid` is unreaped: until then no other process can carry its
 * number as a parent, a group or a session, so nothing unrelated matches.
 * Empty without `/proc` (macOS), where the group signal is all there is.
 */
function startedOutsideGroup(pid: number): ProcEntry[] {
  if (!existsSync('/proc/self/stat')) return [];
  const table: ProcEntry[] = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const entry = readProcEntry(name);
    if (entry && !entry.zombie) table.push(entry);
  }
  const children = new Map<number, ProcEntry[]>();
  for (const entry of table) {
    const siblings = children.get(entry.ppid);
    if (siblings) siblings.push(entry);
    else children.set(entry.ppid, [entry]);
  }
  const found = new Map<number, ProcEntry>();
  const queue = [pid];
  for (const entry of table) {
    if (entry.sid !== pid || entry.pid === pid) continue;
    found.set(entry.pid, entry);
    queue.push(entry.pid);
  }
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    for (const entry of children.get(next) ?? []) {
      if (entry.pid === pid || found.has(entry.pid)) continue;
      found.set(entry.pid, entry);
      queue.push(entry.pid);
    }
  }
  return [...found.values()].filter((entry) => entry.pgid !== pid);
}

/**
 * Run one child under `deadline` — the `ytdlp.ts:runYtdlp` shape. `detached`
 * gives the child its own process group, so a stop reaches it and everything
 * IT started, and nothing else: on expiry, SIGTERM the group, SIGKILL it after
 * `killGraceMs` (or as soon as the child itself exits, for anything it left
 * behind), and reject with the stage's timeout — only once the child has
 * closed, so a caller never races a still-running child. What the child
 * started outside its group (`startedOutsideGroup`) gets the same two signals,
 * each process only while its pid still names it, and the stage settles once
 * that is gone too. If even SIGKILL brings no `close` within another grace,
 * reject anyway and say what is left: a child that did not exit, a process
 * outside its group still running, or a holder of its stdout no listing
 * found. That pipe is then closed on this side and the child unref'd, so no
 * handle of the stage keeps the process alive: the run stays bounded.
 */
function spawnBounded(
  stage: string,
  cmd: string,
  args: string[],
  deadline: StageDeadline,
  killGraceMs: number,
  captureStdout: boolean,
): Promise<BoundedChildResult> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const stdio: StdioOptions = captureStdout
      ? ['ignore', 'pipe', 'ignore']
      : ['ignore', 'inherit', 'inherit'];
    const child = spawn(cmd, args, { stdio, detached: true });
    let stdout = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });

    let settled = false;
    // The timeout detail, once the deadline has passed.
    let timedOut: string | undefined;
    // How the child itself ended: `close` also waits for every holder of its
    // stdout, and may never come.
    let exited: string | undefined;
    let closed = false;
    // What the child started outside its group, listed while it lived:
    // signalled beside the group, and named if it outlives the cleanup.
    const outside = new Map<
      number,
      { entry: ProcEntry; unreachable: boolean }
    >();
    const timers: NodeJS.Timeout[] = [];
    let poll: NodeJS.Timeout | undefined;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      clearInterval(poll);
      fn();
    };
    const killGroup = (signal: NodeJS.Signals): void => {
      const pid = child.pid;
      if (pid === undefined) return;
      try {
        process.kill(-pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch (err) {
          // ESRCH is the child already gone; anything else (EPERM) means the
          // signal never landed and a process it started may live on.
          const code =
            err instanceof Error && 'code' in err ? err.code : undefined;
          if (code !== 'ESRCH') {
            console.warn(
              `[video-toolchain] ${stage}: ${signal} failed for pid ${pid}:`,
              err instanceof Error ? err.message : String(err),
            );
          }
        }
      }
    };

    const stop = (signal: NodeJS.Signals): void => {
      if (exited === undefined && child.pid !== undefined) {
        try {
          for (const entry of startedOutsideGroup(child.pid)) {
            if (!outside.has(entry.pid)) {
              outside.set(entry.pid, { entry, unreachable: false });
            }
          }
        } catch (err) {
          console.warn(
            `[video-toolchain] ${stage}: could not list what pid ${child.pid} started:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      killGroup(signal);
      for (const [pid, held] of outside) {
        if (!stillRunning(held.entry)) {
          outside.delete(pid);
          continue;
        }
        try {
          // A leader of its own group (`setsid`) takes its group with it:
          // every member descends from it, including any it starts late.
          process.kill(held.entry.pgid === pid ? -pid : pid, signal);
        } catch (err) {
          // EPERM: another user's process — the root child sudo starts. The
          // privileged side bounds that one; named below if it outlives this.
          if (errorCode(err) === 'ESRCH') outside.delete(pid);
          else held.unreachable = true;
        }
      }
    };

    // Reject with the timeout, plus what the cleanup left behind — only what
    // was seen: the child's own `exit` tells a child that never exited from
    // one whose stdout something else still holds.
    const finish = (detail: string): void => {
      const left: string[] = [];
      if (exited === undefined) {
        left.push(`pid ${child.pid} did not exit after SIGKILL`);
      }
      for (const { entry, unreachable } of outside.values()) {
        if (!stillRunning(entry)) continue;
        left.push(
          `pid ${entry.pid} (${entry.comm}), outside its process group, ${unreachable ? 'could not be signalled' : 'still runs after SIGKILL'}`,
        );
      }
      if (exited !== undefined && !closed) {
        left.push(
          `pid ${child.pid} ${exited}, but a process it started still holds its stdout after the group SIGKILL`,
        );
      }
      settle(() => {
        if (!closed) child.stdout?.destroy();
        if (exited === undefined) child.unref();
        reject(
          new VideoToolchainError(
            stage,
            left.length === 0
              ? detail
              : `${detail}; cleanup incomplete: ${left.join('; ')}`,
          ),
        );
      });
    };

    timers.push(
      setTimeout(() => {
        const detail = timeoutDetail(deadline, startedAt);
        timedOut = detail;
        stop('SIGTERM');
        timers.push(
          setTimeout(() => {
            stop('SIGKILL');
            timers.push(setTimeout(() => finish(detail), killGraceMs));
          }, killGraceMs),
        );
      }, deadline.ms),
    );

    child.on('error', (err) => {
      // After the deadline this is a failed kill (EPERM), not a failed start:
      // keep waiting for `close`, which the final grace above still bounds.
      if (timedOut !== undefined) {
        console.warn(
          `[video-toolchain] ${stage}: could not signal pid ${child.pid}:`,
          err.message,
        );
        return;
      }
      settle(() =>
        resolve({ code: null, signal: null, stdout, spawnError: err }),
      );
    });
    child.on('exit', (code, signal) => {
      exited =
        signal === null
          ? `exited with code ${code}`
          : `was killed by ${signal}`;
    });
    child.on('close', (code, signal) => {
      closed = true;
      if (settled) return;
      if (timedOut !== undefined) {
        // The child is gone; stop whatever it left behind, in its group or
        // not, and settle once that is gone — the final grace still bounds it.
        stop('SIGKILL');
        const detail = timedOut;
        const finishOnceStopped = (): void => {
          for (const { entry } of outside.values()) {
            if (stillRunning(entry)) return;
          }
          finish(detail);
        };
        finishOnceStopped();
        if (!settled) poll = setInterval(finishOnceStopped, 25);
        return;
      }
      settle(() => resolve({ code, signal, stdout }));
    });
  });
}

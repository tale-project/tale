/*
  Dev orchestrator for LOCAL development — the library half.

  `runDevFleet()` is the whole orchestration; the thin `./dev.ts` shim is the
  entry point (kept at that path so turbo `@tale/platform#dev`, playwright's
  webServer, and the root `scripts/dev.ts` supervisor all keep spawning it). The
  pure, tested pieces live in their own modules: `./convex-supervisor` (restart
  state machine), `./dev-secrets`, `./dev-modes`, `./dev-gates`, `./dev-output`.

  IMPORTANT: This script uses Convex in LOCAL mode. When running Convex for the
  first time, you may see a setup prompt — ALWAYS choose "Local development" to
  avoid cloud dependencies.

  Process:
  1) Load environment variables from .env and .env.local files
     Priority: services/platform/.env.local > services/platform/.env > repo root/.env.local > repo root/.env
  2) Start Convex dev server in LOCAL mode (listening on 127.0.0.1:3210)
  3) Wait until it's listening on the local port (using wait-on library)
  4) Sync .env vars into Convex (SITE_URL, Entra ID keys, etc.)
  5) Trigger code generation with updated environment
  6) Start TanStack Start dev server with loaded environment variables
  7) Handle Ctrl+C (SIGINT/SIGTERM) to cleanly shut down both processes

  This ensures local development without cloud dependencies and avoids timing issues.

  Uses Bun native spawn + wait-on library for proper signal handling (Ctrl+C works correctly).
*/

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import process from 'node:process';

import type { Classifier } from '@tale/shared/classify';
import { openUrl } from '@tale/shared/process';
import { detectCapabilities } from '@tale/shared/terminal';
import { configureReporter } from '@tale/shared/tux';
import kill from 'tree-kill';

import { runConvexLocalMaintenance } from './convex-local-maintenance';
import {
  onConvexReady,
  onHealthTick,
  onRestartSettled,
  planRestart,
  type SupervisorState,
  SUPERVISOR_LIMITS,
} from './convex-supervisor';
import { DEV_GATES } from './dev-gates';
import {
  adoptCliEndpoints,
  DEFAULT_CONVEX_HOST,
  DEFAULT_CONVEX_PORT,
  isTruthy,
  resolveConvexProbeTarget,
  shouldOpenBrowser,
} from './dev-modes';
import {
  convexClassifier,
  detailLines,
  dockerClassifier,
  doneLine,
  errorLine,
  infoLine,
  pipeChild,
  rule,
  runStep,
  StepWarning,
  viteClassifier,
  warnLine,
} from './dev-output';
import { deriveDevSecrets } from './dev-secrets';
import { probeNodeExecutor } from './node-executor-probe';

const platformRoot = join(import.meta.dir, '..');
const repoRoot = join(import.meta.dir, '..', '..', '..');

// Wall-clock boot start, so the orchestrator can show how long each phase took.
// Convex pre-warm dominates a cold boot (30-90s) — surfacing it turns an opaque
// wait into a measurable number.
const BOOT_STARTED_AT = Date.now();
const sinceBoot = (): string =>
  `${((Date.now() - BOOT_STARTED_AT) / 1000).toFixed(1)}s`;

// Docker backing services the HOST `bun dev` depends on (Convex + Vite run on
// the host; these run in docker). Excludes the host-run convex/platform and the
// dev-irrelevant proxy/docs/controller. `sandbox-llm-gateway` is the one with no
// published port in base compose.yml — see DEV_COMPOSE_FILES.
//
// Note: knowledge-db `depends_on convex` in base compose.yml only to wait for it
// to seed the shared convex-data config volume. compose.sandbox-llm-gateway.dev.yml
// (host bun-dev only) drops that edge via `!override` — the host backend owns
// config here, not the docker convex — so this bring-up does NOT pull up a
// redundant convex container alongside the host one.
const DEV_DOCKER_SERVICES = [
  'db',
  // ParadeDB for the knowledge base / RAG search corpus (formerly the separate
  // rag + crawler services, consolidated into the tale-db image — see the
  // knowledge-db migration wiring).
  'knowledge-db',
  'sandbox-llm-gateway',
  'sandbox',
  'sandbox-egress',
  // socat relay aliased `convex` on the sandbox net → host-run convex :3211,
  // so the in-container MCP integration bridge can reach convex http actions
  // (the `--internal` sandbox net can't otherwise reach the host).
  'convex-relay',
];
// Overlay chain for local dev (matches docs/.../docker-compose-reference): base
// + source-mounts/debug/extra_hosts (dev) + the loopback gateway port publish
// (sandbox-llm-gateway.dev). compose.docs.yml is required because compose.dev.yml
// carries a `docs` override whose base service lives only in compose.docs.yml —
// omit it and compose rejects the whole project ("docs has neither an image nor
// a build context"), even though we never start the docs service here. The base
// file alone leaves the LLM gateway unreachable from the host, which kills every
// external-agent turn.
const DEV_COMPOSE_FILES = [
  'compose.yml',
  'compose.dev.yml',
  'compose.docs.yml',
  'compose.sandbox-llm-gateway.dev.yml',
];

function parseDotEnv(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(filePath)) return result;
  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function envNormalizeCommon() {
  process.env.NODE_ENV = 'development';
  if (!process.env.PORT) process.env.PORT = '3000';
  if (!process.env.HOSTNAME) process.env.HOSTNAME = '0.0.0.0';

  // Third-party telemetry opt-out for local dev, set in code so `.env` stays
  // clean. DO_NOT_TRACK is the cross-tool standard (consoledonottrack.com);
  // the rest are explicit per-tool toggles. `??=` lets an explicit override
  // win. (CI sets these in .github/actions/setup-turbo, Docker at runtime,
  // Storybook via its own config.)
  process.env.DO_NOT_TRACK ??= '1';
  process.env.TURBO_TELEMETRY_DISABLED ??= '1';
  process.env.STORYBOOK_DISABLE_TELEMETRY ??= '1';
  process.env.SCARF_ANALYTICS ??= 'false';
  process.env.HF_HUB_DISABLE_TELEMETRY ??= '1';

  const port = process.env.PORT || '3000';
  const host = process.env.HOST || 'localhost';

  if (!process.env.INSTANCE_NAME) process.env.INSTANCE_NAME = 'tale_platform';

  if (!process.env.SITE_URL) {
    process.env.SITE_URL = `http://${host}${host === 'localhost' ? `:${port}` : ''}`;
  }

  // Sandbox → Convex reachability. The URLs the platform hands the sandbox are
  // fetched by the SESSION CONTAINER's daemon (not the spawner), which sits on
  // the `--internal` sandbox net and whose undici fetch ignores the egress
  // proxy — so it can only reach Convex via the `convex` alias carried on that
  // network. In `bun dev` Convex runs on the host, so the `convex-relay` socat
  // (compose.dev.yml) bridges :3210/:3211 → host Convex. (`host.docker.internal`
  // resolves for the spawner but NOT for session containers, which is why it
  // never worked for storage staging — see SANDBOX_CONVEX_STORAGE_BASE_DEFAULT.)
  //
  // Override in `services/platform/.env.local` only for a non-standard topology.
  if (!process.env.SANDBOX_STORAGE_INTERNAL_BASE_URL) {
    process.env.SANDBOX_STORAGE_INTERNAL_BASE_URL = 'http://convex:3210';
  }
  if (!process.env.SANDBOX_HTTP_API_BASE_URL) {
    process.env.SANDBOX_HTTP_API_BASE_URL = 'http://convex:3211';
  }

  // Writable per-org config ROOT (org-first: `<root>/<orgSlug>/<domain>/`).
  // Convex derives sub-dirs from TALE_CONFIG_DIR via `convex/*/file_utils.ts`.
  // Default to a gitignored repo-relative dir: each org's files are seeded into
  // it from the built-in catalog at org-create. NOT the built-in catalog itself
  // (that is `configs/platform/custom/`, which is not org-shaped). An explicit env wins
  // (the user's .env or the E2E fixture point this at their own writable root).
  if (!process.env.TALE_CONFIG_DIR) {
    process.env.TALE_CONFIG_DIR = join(repoRoot, '.tale', 'config');
  }

  // Built-in config catalog: the single GENERIC template every org is seeded
  // from. Its children ARE the org-scaffold domains
  // (`configs/platform/custom/<domain>/` — agents, automations, branding,
  // governance, skills), with no org level, so the seeder reads
  // `<catalog>/<domain>` with no `default` join. System config
  // (`configs/platform/system/`) is org-independent and deliberately NOT part
  // of this root. Prod sets this in the image (services/convex/Dockerfile copies
  // the catalog → /app/builtin; services/platform/Dockerfile sets the env to
  // /app/builtin). Dev has no build step, so default it to the repo's tracked
  // catalog. Hermetic setups (E2E) pin their own builtin explicitly rather than
  // inheriting this default.
  if (!process.env.TALE_CONFIG_BUILTIN_DIR) {
    process.env.TALE_CONFIG_BUILTIN_DIR = join(
      repoRoot,
      'configs',
      'platform',
      'custom',
    );
  }
}

// The ordered secret derivation (instance / better-auth / WebDAV-HMAC /
// encryption) lives in `./dev-secrets` — pure, tested, and reusing the SAME
// `ensureWebdavHmacKey` the platform verifies with (no second formula).

// WebDAV's dev route (vite-plugins/serve-webdav.ts) talks to Convex with the
// deployment ADMIN_KEY to call internal functions; without it the plugin
// disables /dav/* and every request returns 503. Prod derives the key with the
// `generate_key` binary in docker-entrypoint.sh, but the Convex CLI does NOT
// download that binary for local dev — it instead writes the anonymous
// deployment's admin key in cleartext to .convex/local/default/config.json.
// Read it from there so `bun dev` enables WebDAV with zero manual setup. Only
// meaningful for the local backend (the file is a local-CLI artifact); an
// explicit ADMIN_KEY (.env) always wins. MUST run after waitForConvex() so the
// CLI has created the config file.
function ensureLocalAdminKey() {
  if (process.env.ADMIN_KEY) return;
  const configPath = join(platformRoot, '.convex/local/default/config.json');
  if (!existsSync(configPath)) {
    warnLine(
      `${configPath} not found; ADMIN_KEY unset, WebDAV /dav/* will 503.`,
    );
    return;
  }
  try {
    const adminKey = JSON.parse(readFileSync(configPath, 'utf8'))?.adminKey;
    if (typeof adminKey !== 'string' || adminKey.length === 0) {
      warnLine('No adminKey in local Convex config; WebDAV /dav/* will 503.');
      return;
    }
    process.env.ADMIN_KEY = adminKey;
    // ADMIN_KEY loaded → WebDAV /dav/* enabled (routine, no log).
  } catch (err) {
    warnLine(
      `Failed to read local Convex admin key (${configPath}); WebDAV /dav/* will 503. Underlying: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// Video-link ingestion (chat "paste a YouTube URL") spawns yt-dlp + ffmpeg from
// a Convex node action. Production BAKES those binaries into the convex image on
// pinned paths; a host `bun dev` backend has neither, so ingestion used to fail
// "yt-dlp binary not found" until the operator hand-set VIDEO_INGEST_* (#2746).
// Reuse the SAME self-provisioner the live YouTube test uses — download yt-dlp +
// deno into a per-user cache, resolve ffmpeg — and export the paths the node
// action reads (VIDEO_INGEST_BIN_DIR / _FFMPEG_LOCATION / _YTDLP_PLUGIN_DIRS).
// The explicit-value-wins rule (only fill gaps) lets a self-hoster pin their own
// baked paths. Best-effort: a download/network failure warns and continues —
// video ingestion is optional and the rest of the stack must still boot. The
// exported vars are synced into the Convex deployment env by the caller.
async function provisionVideoToolchain(): Promise<void> {
  if (
    process.env.VIDEO_INGEST_BIN_DIR &&
    process.env.VIDEO_INGEST_FFMPEG_LOCATION
  ) {
    return; // Operator pinned both — respect it, skip the download.
  }
  try {
    const { ensureVideoToolchain } =
      await import('../convex/video_links/ytdlp_toolchain');
    const tc = await ensureVideoToolchain();
    process.env.VIDEO_INGEST_BIN_DIR ||= tc.binDir;
    process.env.VIDEO_INGEST_FFMPEG_LOCATION ||= tc.ffmpegLocation;
    process.env.VIDEO_INGEST_YTDLP_PLUGIN_DIRS ||= tc.pluginDir;
  } catch (err) {
    warnLine(
      'Video toolchain provisioning failed — pasting a video link in chat ' +
        "won't produce a transcript until it's installed. Underlying: " +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

function loadEnvFiles() {
  // Lowest → highest precedence; a later file's value wins on collision
  // (platform overrides repo, `.local` overrides base).
  const sources = [
    { label: 'repo/.env', path: join(repoRoot, '.env') },
    { label: 'repo/.env.local', path: join(repoRoot, '.env.local') },
    { label: 'platform/.env', path: join(platformRoot, '.env') },
    { label: 'platform/.env.local', path: join(platformRoot, '.env.local') },
  ];

  const mergedEnv: Record<string, string> = {};
  for (const { path } of sources) {
    const vars = parseDotEnv(path);
    Object.assign(mergedEnv, vars);
  }

  // Pre-existing process.env wins over .env files — only fill the gaps.
  let loadedCount = 0;
  let skippedCount = 0;
  for (const [key, value] of Object.entries(mergedEnv)) {
    if (key in process.env) {
      skippedCount++;
    } else {
      process.env[key] = value;
      loadedCount++;
    }
  }

  // Routine success is silent — only the count is interesting when nothing
  // loaded (likely a misconfigured checkout), so surface only that case.
  if (loadedCount === 0 && skippedCount === 0) {
    warnLine('No environment variables found in any .env file.');
  }
}

function runCommand(
  cmd: string,
  args: string[],
  env: Record<string, string> = {},
  cwd: string = platformRoot,
  output: { label?: string; classifier?: Classifier } = {},
) {
  return new Promise<void>((resolve, reject) => {
    // Capture (not inherit) so the raw subprocess firehose — docker pull/build
    // layers, convex push spam, codegen output — is classified and collapsed
    // to clean status instead of dumped to the terminal. A failing step prints
    // its captured tail before rejecting, so the cause is never silently lost.
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      env: { ...process.env, ...env },
    });
    const piped = pipeChild(child, {
      label: output.label ?? cmd,
      classifier: output.classifier,
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      // Prefer the classified warn/error lines (the real cause); fall back to a
      // raw tail with BuildKit `#N` progress filtered out so a failure dump is
      // signal, not the build firehose.
      const signal = piped.signal();
      const lines =
        signal.length > 0
          ? signal.slice(-15)
          : piped.tail(15).filter((line) => !/^#\d+\s/.test(line));
      if (lines.length > 0) detailLines(lines);
      reject(new Error(`${cmd} exited with code ${code}`));
    });
    child.on('error', (err) => reject(err));
  });
}

// The restart/health thresholds live with the (tested) state machine in
// `./convex-supervisor`; the orchestrator only needs them for its probe timer
// and user-facing messages.
const {
  HEALTH_CHECK_INTERVAL_MS,
  HEALTH_CHECK_TIMEOUT_MS,
  MAX_CONSECUTIVE_FAILURES,
  MAX_AUTO_RESTARTS,
} = SUPERVISOR_LIMITS;

/** Resolve the Convex probe/proxy target (honoring CONVEX_URL), surfacing a
 *  malformed-URL warning through the reporter. Pure logic lives in `./dev-modes`. */
function probeTarget() {
  return resolveConvexProbeTarget(process.env, warnLine);
}

function tcpProbe(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

/** Fail fast with an actionable message if the app's port is already taken.
 *  Without this (and without Vite's `--strictPort`) Vite quietly falls through
 *  to the next free port — so the orchestrator keeps promising
 *  http://localhost:3000 while the app actually came up on :3001/:3002/etc.
 *  That looks exactly like "I can't reach localhost:3000", so we'd rather stop
 *  here and tell the developer how to free the port. */
async function assertPortFree(port: number): Promise<void> {
  const inUse = await tcpProbe('127.0.0.1', port, DEV_GATES.port.timeoutMs);
  if (!inUse) return;
  throw new Error(
    [
      `Port ${port} is already in use, so the app can't start there.`,
      `   This is usually a previous \`bun run dev\` / \`tale dev\` that didn't fully`,
      `   exit, or another process holding the port. Find and stop it, then re-run:`,
      ``,
      `     lsof -nP -iTCP:${port} -sTCP:LISTEN     # show the PID holding it`,
      `     kill <PID>                              # stop it`,
      ``,
      `   Or run the app on a different port:  PORT=3005 bun run dev`,
    ].join('\n'),
  );
}

/** Build `docker compose -f ... -f ...` argv with the dev overlay chain. */
function dockerComposeArgs(rest: string[]): string[] {
  return ['compose', ...DEV_COMPOSE_FILES.flatMap((f) => ['-f', f]), ...rest];
}

/**
 * Ensure the shared `tale-sandbox-net` exists before bringing up the sandbox
 * services, which reference it as an EXTERNAL network. `tale dev` creates it
 * via the CLI, but `bun run dev` never did — so the docker bring-up failed with
 * "network tale-sandbox-net declared as external, but could not be found". It's
 * `--internal` (no internet; runtime containers reach pypi/npm only via the
 * egress proxy) with IPv6 off so the v4 iptables fence is complete — matching
 * the CLI's `ensureSandboxNetwork`. Synchronous + quiet; warn-and-continue.
 */
function ensureSandboxNetwork(): void {
  const name = 'tale-sandbox-net';
  const exists = spawnSync('docker', ['network', 'inspect', name], {
    stdio: 'ignore',
  });
  if (exists.status === 0) return;
  const created = spawnSync(
    'docker',
    [
      'network',
      'create',
      '--internal',
      '--ipv6=false',
      '--driver=bridge',
      name,
    ],
    { stdio: 'ignore' },
  );
  if (created.status !== 0) {
    warnLine(
      `Could not create sandbox network ${name}; sandbox bring-up may fail.`,
    );
  }
}

/** Non-fatal docker availability probe. Mirrors the CLI's assertDockerAvailable
 *  (tools/cli/src/lib/actions/dev.ts) but resolves a status instead of
 *  throwing, so `bun dev` can warn-and-continue when docker is missing. */
function probeDocker(
  timeoutMs: number,
): Promise<'ok' | 'no-binary' | 'no-daemon'> {
  return new Promise((resolve) => {
    const child = spawn('docker', ['info'], { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve('no-daemon');
    }, timeoutMs);
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve(err.code === 'ENOENT' ? 'no-binary' : 'no-daemon');
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? 'ok' : 'no-daemon');
    });
  });
}

/** Launch the Docker engine for the host OS, fire-and-forget — the engine then
 *  comes up asynchronously (which {@link startDockerDaemon} polls for). Returns
 *  whether the launch command itself succeeded. Mirrors the per-OS launch in the
 *  CLI's ensureDocker (tools/cli/src/lib/docker/ensure-docker.ts): `open -a
 *  Docker` on macOS, Start-Process on Windows, `systemctl start docker` on Linux.
 *  The Linux path uses `sudo -n` so it FAILS FAST when passwordless sudo isn't
 *  configured, rather than hanging the boot on a hidden password prompt. */
function launchDockerEngine(): boolean {
  try {
    if (process.platform === 'darwin') {
      return (
        spawnSync('open', ['-a', 'Docker'], { stdio: 'ignore' }).status === 0
      );
    }
    if (process.platform === 'win32') {
      return (
        spawnSync(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            'Start-Process -FilePath "$env:ProgramFiles\\Docker\\Docker\\Docker Desktop.exe"',
          ],
          { stdio: 'ignore' },
        ).status === 0
      );
    }
    // Linux: the engine runs as a privileged systemd service. `-n` makes sudo
    // fail immediately (instead of prompting) when passwordless sudo is absent.
    return (
      spawnSync('sudo', ['-n', 'systemctl', 'start', 'docker'], {
        stdio: 'ignore',
      }).status === 0
    );
  } catch (err) {
    warnLine(
      `Could not start the Docker engine: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/** Wake a stopped Docker engine so `bun dev` doesn't dead-end when Docker Desktop
 *  just isn't running — the common case on a dev machine. Launches it (see
 *  {@link launchDockerEngine}) then polls until it answers or ~60s elapse.
 *  Best-effort and non-fatal: returns the re-probed status; the caller degrades
 *  to a warning when it stays down. */
async function startDockerDaemon(): Promise<'ok' | 'no-daemon'> {
  const ready = await runStep(
    { active: 'Starting the Docker engine', done: 'Docker engine started' },
    async () => {
      if (!launchDockerEngine()) {
        throw new StepWarning(
          'could not launch it (start Docker manually if this keeps happening)',
        );
      }
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if ((await probeDocker(5_000)) === 'ok') return true;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      throw new StepWarning('the engine did not come up within 60s');
    },
  );
  return ready ? 'ok' : 'no-daemon';
}

/** Probe the LLM gateway on its host-published loopback port until it accepts
 *  connections — this is the axis that breaks when the dev overlay's port
 *  binding is missing. Honours SANDBOX_LLM_GATEWAY_URL (falls back to the
 *  pre-rename LLM_GATEWAY_URL); warn-and-continue on timeout. */
async function waitForLlmGateway(
  timeoutMs = DEV_GATES.llmGateway.timeoutMs,
): Promise<void> {
  let host = '127.0.0.1';
  let port = 8080;
  const raw =
    process.env.SANDBOX_LLM_GATEWAY_URL ?? process.env.LLM_GATEWAY_URL;
  if (raw) {
    try {
      const u = new URL(raw);
      host = u.hostname || host;
      port = u.port ? Number(u.port) : port;
    } catch {
      warnLine(
        `SANDBOX_LLM_GATEWAY_URL=${raw} is not a valid URL; probing ${host}:${port}`,
      );
    }
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Reachable → silent (routine); the docker step already reported success.
    if (await tcpProbe(host, port, 2_000)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  warnLine(
    `LLM gateway not reachable at ${host}:${port} within ${timeoutMs / 1000}s — external-agent turns may fail with "fetch failed".`,
  );
}

/** Bring up the docker backing services the host `bun dev` depends on, WITH the
 *  dev overlays. Host bun dev runs Convex + Vite on the host, but the LLM
 *  gateway, sandbox spawner, db and knowledge-db run in docker. The base
 *  compose.yml publishes NO gateway port (prod posture) — only
 *  compose.sandbox-llm-gateway.dev.yml maps 127.0.0.1:8080 — so a plain `docker compose
 *  up` silently drops the loopback binding and the host Convex action can't
 *  reach the gateway (every external-agent turn then dies with "fetch failed").
 *  Doing the bring-up here, with the overlay chain, makes `bun dev`
 *  self-sufficient and keeps the port from drifting.
 *
 *  Idempotent: an already-overlay stack recreates nothing; after a prior bare
 *  `up` it recreates whatever config drifted (the gateway gains its port, the
 *  rest gain source mounts / extra_hosts) — the intended convergence to dev
 *  config.
 *
 *  A stopped engine is auto-started first (Docker Desktop / systemd) so a dev
 *  machine where Docker simply isn't running doesn't have to start it by hand.
 *  Docker absent (or unstartable) is NON-FATAL: warn with the concrete
 *  side-effects and let the app come up anyway (pure frontend/Convex work
 *  doesn't need it). */
async function ensureDockerDependencies(): Promise<void> {
  // The hermetic E2E stack (playwright.config.ts) is anonymous-Convex + mock
  // LLM with "no external services" — the backing images aren't built in the
  // E2E CI job, so `docker compose up` can only ever fail there. Attempting it
  // wastes the cold-boot budget and destabilizes the Convex pre-warm that
  // follows. Let the E2E webServer opt out explicitly.
  if (isTruthy(process.env.TALE_DEV_SKIP_DOCKER)) {
    infoLine('Skipping Docker backing services (TALE_DEV_SKIP_DOCKER set)');
    return;
  }

  // Stop spurious container churn on every `bun dev`. The db/sandbox/
  // sandbox-egress services have `build:` blocks with `pull_policy: build`, so
  // `docker compose up` runs their build step on every bring-up. Under buildx
  // with the containerd image store (Docker Desktop default), BuildKit attaches
  // a provenance attestation by default — its metadata is non-deterministic, so
  // even a 100%-cached build re-exports a NEW image manifest digest. compose
  // then sees the service image no longer matches the running container's image
  // and recreates the container — every single run. (External-image services
  // like sandbox-llm-gateway/convex-relay are never built, so they stay put — which is
  // why only the build-services churned.) Disabling the default attestation makes
  // the cached build reproduce a stable image ID, so an already-up stack
  // converges to a no-op. Scoped to dev: CI/release builds run in their own
  // processes and keep provenance for supply-chain integrity. Explicit override
  // still wins.
  process.env.BUILDX_NO_DEFAULT_ATTESTATIONS ??= '1';

  // Force BuildKit's PLAIN progress writer so build output is deterministic
  // `#N …` lines on the captured stderr pipe (which the docker classifier
  // collapses) rather than an interactive TTY progress stream that could write
  // around the pipe. Explicit override still wins.
  process.env.BUILDKIT_PROGRESS ??= 'plain';

  let status = await probeDocker(10_000);
  // CLI present but the engine is down: try to start it instead of dead-ending —
  // the common case on a dev machine where Docker Desktop simply isn't running.
  if (status === 'no-daemon') {
    status = await startDockerDaemon();
  }
  if (status !== 'ok') {
    // A failed start already explained itself via startDockerDaemon's warning;
    // only the not-installed case still needs a warning here.
    if (status === 'no-binary') {
      warnLine(
        'Docker is not installed — continuing without the backing services.',
      );
    }
    infoLine(
      "While the backing services are down: chat and external agents fail (no LLM gateway), agents can't run code (no sandbox), and the knowledge base / RAG is unavailable (no db).",
    );
    infoLine(
      `Start them with: docker ${dockerComposeArgs(['up', '-d', '--remove-orphans', ...DEV_DOCKER_SERVICES]).join(' ')}`,
    );
    return;
  }

  ensureSandboxNetwork();
  const dockerUp = await runStep(
    {
      active: 'Starting Docker backing services',
      done: 'Docker backing services started',
    },
    async () => {
      // `--remove-orphans` self-heals the project after a service is RENAMED or
      // DELETED from the compose files (e.g. llm-gateway → sandbox-llm-gateway).
      // The old container keeps running and holds its published port, so a fresh
      // `tale-sandbox-llm-gateway` can't bind :8080 ("port is already allocated") and the
      // whole bring-up fails. The flag is project-scoped and only removes
      // containers for services no longer defined ANYWHERE in the compose files —
      // services defined-but-not-started here (platform/controller/proxy/docs) are
      // NOT orphans and stay put, and modern blue-green deploys run under their own
      // `…-blue`/`…-green` projects, so a live deploy is never touched.
      const up = (extra: string[]) =>
        runCommand(
          'docker',
          dockerComposeArgs([
            'up',
            '-d',
            '--remove-orphans',
            ...extra,
            ...DEV_DOCKER_SERVICES,
          ]),
          {},
          repoRoot,
          { label: 'docker', classifier: dockerClassifier },
        );
      // These services default to `pull_policy: build`, so a plain `up` REBUILDS
      // them every time (BuildKit re-exports even a fully-cached image — slow, and
      // it churns containers). Try `--no-build` first to REUSE the already-built
      // images (the fast path; source is bind-mounted in dev, so code changes
      // don't need a rebuild). Only a missing image (fresh checkout) falls through
      // to `--build`. The step is silent on success; the build firehose stays in
      // the ring and is dumped only if both attempts fail. A final failure is
      // non-fatal — degrade to `[ ! ]` and continue (pure frontend/Convex work
      // doesn't need the backing services). Force a rebuild with `--build`
      // yourself, or `PULL_POLICY=build`, after changing a service Dockerfile.
      try {
        await up(['--no-build']);
      } catch {
        try {
          await up(['--build']);
        } catch (err) {
          throw new StepWarning(
            `unavailable, continuing without backing services (${err instanceof Error ? err.message : String(err)})`,
          );
        }
      }
      return true;
    },
  );

  if (dockerUp) await waitForLlmGateway();
}

/** Probe the Better Auth HTTP surface (served by the Convex site proxy on
 *  :3211) until `/api/auth/ok` answers 200. This is a true end-to-end auth
 *  readiness check: it proves the http router is pushed AND the better-auth
 *  handler can execute with its env (BETTER_AUTH_SECRET etc.). On the FIRST
 *  run in a clean repo the browser used to race this bootstrap — the page's
 *  initial session/token fetches failed, the auth provider latched the
 *  failure, and the app sat in skeletons until a manual reload. Probing
 *  before Vite starts means the app is never reachable before auth is.
 *  Warn-and-continue on timeout: a genuinely broken auth route fails loudly
 *  in the browser anyway, and the client now retries transient failures. */
async function waitForAuthRoutes(
  timeoutMs = DEV_GATES.authOk.timeoutMs,
): Promise<void> {
  const convexBase =
    process.env.CONVEX_URL ||
    `http://${DEFAULT_CONVEX_HOST}:${DEFAULT_CONVEX_PORT}`;
  // Derive the Convex site-proxy origin (:3211) from CONVEX_URL. Parse with
  // URL and set the port explicitly so a trailing slash or path on CONVEX_URL
  // (e.g. `http://127.0.0.1:3210/`) can't defeat a `:\d+$` swap and leave the
  // probe pointed at the backend port — which would block startup for the full
  // timeout despite auth being healthy on :3211.
  const siteBase =
    process.env.CONVEX_SITE_PROXY_URL ||
    (() => {
      const u = new URL(convexBase);
      u.port = '3211';
      u.pathname = '';
      u.search = '';
      u.hash = '';
      return u.toString();
    })();
  const url = `${siteBase.replace(/\/$/, '')}/api/auth/ok`;
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response yet';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      // Expected while the backend is still warming — remember the failure
      // for the timeout warning instead of spamming once per second.
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  warnLine(
    `Auth routes did not answer at ${url} within ${timeoutMs / 1000}s (last: ${lastError}) — continuing; the first page load may need the in-app auth retry.`,
  );
}

/** Poll until the dev server is actually accepting connections, then print one
 *  unmistakable READY banner. This matters because (a) the log line printed
 *  just before spawning Vite only *promises* the URL — the socket isn't bound
 *  yet — and (b) under `turbo run dev` the platform is the MAIN app but the
 *  SLOWEST to start (it waits on the Convex pre-warm), coming up ~20-60s after
 *  the lighter web/docs servers print their own "Local: …" lines. Without a
 *  distinct post-bind signal, developers open :3000 too early, hit
 *  connection-refused, and assume it's broken. */
async function announceWhenReady(port: number, url: string): Promise<void> {
  const deadline = Date.now() + DEV_GATES.viteBind.timeoutMs;
  while (Date.now() < deadline) {
    if (await tcpProbe('127.0.0.1', port, 1_000)) {
      rule();
      doneLine(`READY in ${sinceBoot()} — open ${url} in your browser`);
      rule();
      // Pop the app for an interactive `bun run dev` (skipped under CI / a
      // TALE_DEV_OPEN opt-out). Best-effort: a failed opener just leaves the URL
      // printed above, so never block or fail the orchestrator on it.
      if (shouldOpenBrowser()) {
        void openUrl(url, { onDebug: (m) => detailLines([m]) });
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function killProcessTree(
  proc: ChildProcess | null,
  signal: string = 'SIGKILL',
): Promise<void> {
  return new Promise((resolve) => {
    if (!proc || proc.killed || !proc.pid) {
      resolve();
      return;
    }
    const onExit = () => resolve();
    proc.once('exit', onExit);
    kill(proc.pid, signal, (err) => {
      if (err) {
        proc.removeListener('exit', onExit);
        resolve();
      }
    });
  });
}

export async function runDevFleet() {
  // Phase 2 (split architecture): if CONVEX_EXTERNAL=true, the developer has
  // a convex backend running externally (e.g., `docker compose up convex`).
  // Skip spawning a local `bunx convex dev` and just run Vite with env sync.
  // Accept any case-variant truthy value so CONVEX_EXTERNAL=1 / True / yes work.
  const useExternalConvex = isTruthy(process.env.CONVEX_EXTERNAL);

  infoLine('Starting Tale dev environment');
  if (useExternalConvex) {
    infoLine(
      `Using external Convex (${process.env.CONVEX_URL || 'http://127.0.0.1:3210'})`,
    );
  }

  let convexProcess: ChildProcess | null = null;
  let viteProcess: ChildProcess | null = null;
  let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  let shuttingDown = false;
  let restartCount = 0;
  let convexReadyAt = 0;
  let consecutiveFailures = 0;
  let restarting = false;

  // The restart/health DECISIONS live in the pure, tested reducers in
  // `./convex-supervisor`; these two helpers snapshot the orchestrator's mutable
  // state into the reducer and write the result back. `shuttingDown` is owned by
  // `shutdown()` (the reducers only read it), so it is never written back here.
  const snapshot = (): SupervisorState => ({
    restartCount,
    convexReadyAt,
    consecutiveFailures,
    restarting,
    shuttingDown,
  });
  const applyState = (s: SupervisorState): void => {
    restartCount = s.restartCount;
    convexReadyAt = s.convexReadyAt;
    consecutiveFailures = s.consecutiveFailures;
    restarting = s.restarting;
  };

  try {
    loadEnvFiles();
    // Re-configure the reporter now that .env is loaded, so a NO_COLOR /
    // FORCE_COLOR / CI set there is honored (the import-time probe ran before
    // the dotenv files were read). Same single source `tale` configures.
    configureReporter(detectCapabilities());

    envNormalizeCommon();
    deriveDevSecrets(process.env);
    const deployment = process.env.CONVEX_DEPLOYMENT;
    const hasLocalDeployment = deployment?.startsWith('anonymous:');
    // A cloud deployment in env would override local dev — drop it (routine, no log).
    if (deployment && !hasLocalDeployment) {
      delete process.env.CONVEX_DEPLOYMENT;
    }

    // Run every local Convex CLI invocation in anonymous (local-only) mode.
    // Besides skipping the cloud login flow, an explicit
    // CONVEX_AGENT_MODE=anonymous also SUPPRESSES the CLI's repeated
    //   "Run `npx convex login` at any time to create an account ..."
    // hint — the CLI only prints that when this var is *not* 'anonymous'
    // (see convex/src/cli/lib/init.ts). Setting it on process.env means the
    // pre-warm, the spawned `convex dev`, env-sync and codegen all inherit it.
    // We never force it in external mode — that backend may be a real
    // cloud/self-hosted deployment where anonymous mode would be wrong.
    if (!useExternalConvex) {
      process.env.CONVEX_AGENT_MODE = 'anonymous';
    }

    // Port + URL are fully resolved now (envNormalizeCommon set PORT/SITE_URL),
    // so derive the app's address from those — honouring PORT/SITE_URL
    // overrides instead of hardcoding localhost:3000.
    const appPort = Number(process.env.PORT || '3000');
    const appUrl = process.env.SITE_URL || `http://localhost:${appPort}`;

    // Fail fast (before the slow Convex pre-warm) if the app's port is taken —
    // otherwise Vite silently moves to another port and every "${appUrl}"
    // message we print becomes a lie.
    await assertPortFree(appPort);

    // Heads up first, before any of the slow work: a cold start can take
    // 30-90s (the Convex pre-warm dominates); the app stays unreachable until
    // the READY banner below. Everything between "Starting" and here is silent,
    // so this lands as the second line the developer sees.
    infoLine(
      `Cold start takes 30-90s — ${appUrl} won't load until the READY banner below.`,
    );

    // Bring up the docker backing stack (gateway, sandbox, db, knowledge-db)
    // WITH the dev overlays before Convex/Vite. Host bun dev runs Convex+Vite on
    // the host but depends on these in docker; the LLM gateway in particular
    // has no published port in base compose.yml, so without this an external
    // agent turn dies with "fetch failed". Runs in BOTH local and external
    // Convex modes; non-fatal if docker is absent (warns + continues).
    await ensureDockerDependencies();

    // Inherits CONVEX_AGENT_MODE=anonymous from process.env (set above) in
    // local mode, so the spawned backend runs anonymous and stays quiet.
    const convexEnv = { ...process.env };

    function spawnConvex() {
      convexProcess = spawn('npx', ['convex', 'dev'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: platformRoot,
        env: convexEnv,
      });
      // Persistent server: surface milestones ("N functions ready") + errors,
      // collapse the push/codegen/idle-watch noise.
      pipeChild(convexProcess, {
        label: 'convex',
        classifier: convexClassifier,
        mode: 'errors',
      });
      convexProcess.on('exit', (code) => {
        if (shuttingDown || restarting) return;
        infoLine(`Convex exited with code ${code}`);
        void shutdown();
      });
    }

    // E2E mitigation: on the shared 4-vCPU CI runner the local backend competes
    // with Vite + the browser for CPU and blows its hard ~1s function timeout.
    // Give `convex-local-backend` a scheduling-priority edge so its UDFs win the
    // race. Best-effort and E2E/Linux-only — never blocks or fails the boot
    // (renice needs CAP_SYS_NICE, available via passwordless sudo on GH runners;
    // a no-op everywhere else). Pairs with the sub-hourly cron skip in crons.ts.
    function prioritizeConvexForE2E() {
      if (process.env.TALE_E2E !== '1' || process.platform !== 'linux') return;
      try {
        const found = spawnSync('pgrep', ['-f', 'convex-local-backend'], {
          encoding: 'utf8',
        });
        const pids = (found.stdout ?? '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        if (pids.length === 0) return;
        spawnSync('sudo', ['-n', 'renice', '-n', '-10', '-p', ...pids], {
          stdio: 'ignore',
        });
        // Raised Convex backend priority for E2E (routine, no log).
      } catch {
        // Best-effort only; starvation mitigation, not a correctness gate.
      }
    }

    // Re-read the CLI-written .env.local and back-fill CONVEX_DEPLOYMENT /
    // CONVEX_URL / CONVEX_SITE_PROXY_URL (see adoptCliEndpoints in dev-modes:
    // a fresh checkout beside another stack gets NON-default ports, and the
    // probes + Vite proxy would otherwise silently target the neighbour).
    function adoptCliEndpointsFromEnvLocal() {
      adoptCliEndpoints(
        process.env,
        parseDotEnv(join(platformRoot, '.env.local')),
      );
    }

    async function waitForConvex() {
      if (!useExternalConvex) adoptCliEndpointsFromEnvLocal();
      const target = probeTarget();
      try {
        await runCommand('bunx', [
          'wait-on',
          `tcp:${target.host}:${target.port}`,
          '--timeout',
          String(DEV_GATES.convexTcp.timeoutMs),
          '--interval',
          '250',
        ]);
      } catch (err) {
        // Re-throw with a clearer message for the external case so the
        // developer immediately understands which target failed.
        throw new Error(
          useExternalConvex
            ? `External Convex backend at ${target.url} is not reachable. Is it running? (set CONVEX_URL to override.) Underlying: ${err instanceof Error ? err.message : String(err)}`
            : `Local Convex backend at ${target.host}:${target.port} did not start within 180s. Underlying: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      applyState(onConvexReady(snapshot(), Date.now()));
      prioritizeConvexForE2E();
    }

    async function restartConvex() {
      const plan = planRestart(snapshot(), Date.now(), {
        external: useExternalConvex,
      });
      if (plan.action === 'noop') return;
      if (plan.action === 'noop-external') {
        // We don't own the external backend's process; restart is a no-op.
        warnLine(
          'External Convex appears unreachable; cannot restart it from here. Check the external backend and re-run `tale dev` / `bun run dev` if needed.',
        );
        return;
      }
      applyState(plan.state);

      if (plan.action === 'shutdown-cap') {
        errorLine(
          `Convex failed ${MAX_AUTO_RESTARTS} times in quick succession, shutting down`,
        );
        void shutdown();
        return;
      }

      // plan.action === 'restart'
      warnLine(
        `Convex unresponsive, restarting (attempt ${restartCount}/${MAX_AUTO_RESTARTS})`,
      );

      try {
        await killProcessTree(convexProcess, 'SIGKILL');
        spawnConvex();
        await waitForConvex();
        doneLine('Convex recovered');
      } catch (err) {
        errorLine(
          `Convex failed to recover: ${err instanceof Error ? err.message : String(err)}`,
        );
        applyState(onRestartSettled(snapshot()));
        void shutdown();
        return;
      }

      applyState(onRestartSettled(snapshot()));
    }

    function startHealthCheck() {
      const target = probeTarget();
      healthCheckTimer = setInterval(async () => {
        // Don't even probe while a restart/shutdown is in flight (the reducer
        // would also no-op, but skipping the probe avoids a redundant socket).
        if (shuttingDown || restarting) return;

        const alive = await tcpProbe(
          target.host,
          target.port,
          HEALTH_CHECK_TIMEOUT_MS,
        );
        const childAlive = !(
          convexProcess?.killed || convexProcess?.exitCode != null
        );

        const tick = onHealthTick(snapshot(), {
          alive,
          childAlive,
          external: useExternalConvex,
        });
        applyState(tick.state);

        if (tick.action === 'warn') {
          warnLine(
            `Convex health check failed at ${target.host}:${target.port} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`,
          );
        } else if (tick.action === 'restart') {
          warnLine(
            `Convex health check failed at ${target.host}:${target.port} (${MAX_CONSECUTIVE_FAILURES}/${MAX_CONSECUTIVE_FAILURES})`,
          );
          void restartConvex();
        }
      }, HEALTH_CHECK_INTERVAL_MS);

      healthCheckTimer.unref();
    }

    if (useExternalConvex) {
      await runStep(
        {
          active: 'Connecting to external Convex',
          done: 'Connected to external Convex',
        },
        () => waitForConvex(),
      );
    } else {
      // Make Convex `node.externalPackages` resolvable from
      // services/platform/node_modules (they're hoisted to the repo root in
      // this bun workspace, where Convex's bundler can't find them). Without
      // this the heavy node-only libs get bundled inline and the push fails
      // (canvas.node / jsdom default-stylesheet / module-size). Idempotent.
      try {
        await runCommand('bun', ['scripts/link-convex-externals.ts']);
      } catch (err) {
        warnLine(
          `Failed to link Convex external packages; the push may fail. Underlying: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Non-essential prune/snapshot cleanup must never block backend bring-up,
      // but a missing live module blob is fatal — continuing would boot into
      // the half-dead state (chat/crons InternalServerError + WS drop).
      // Gate on the typed `integrityError` field (not a message substring) so a
      // wording change cannot demote the fatal path to a warn.
      let maintenance: ReturnType<typeof runConvexLocalMaintenance> | null =
        null;
      try {
        maintenance = runConvexLocalMaintenance(platformRoot);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnLine(`Convex local maintenance skipped (non-fatal): ${msg}`);
      }
      if (maintenance?.integrityError) {
        throw new Error(maintenance.integrityError);
      }
      if (maintenance?.warning) {
        warnLine(maintenance.warning);
      }
      if (maintenance?.message) {
        infoLine(maintenance.message);
      }

      // One live line for the whole backend bring-up: the `npx convex dev
      // --once` pre-warm (binary download, SQLite bootstrap, migrations,
      // function push) then the persistent `convex dev` + a port-ready wait.
      // `npx` (not `bunx`) runs the CLI under Node — Bun's timing quirks can
      // blow the CLI's 30s port-ready window even when it's coming up fine.
      await runStep(
        { active: 'Starting Convex backend', done: 'Convex backend started' },
        async () => {
          try {
            await runCommand(
              'npx',
              ['convex', 'dev', '--once'],
              {},
              platformRoot,
              { label: 'convex', classifier: convexClassifier },
            );
          } catch (err) {
            throw new Error(
              `Convex preflight (npx convex dev --once) failed. This usually means a stale backend is holding port 3210, or the local deployment state is corrupt. Try: lsof -i :3210 and kill any leftover 'convex-local-backend' processes. Underlying: ${err instanceof Error ? err.message : String(err)}`,
              { cause: err },
            );
          }
          spawnConvex();
          await waitForConvex();
        },
      );
    }

    // Re-read .env.local in case `convex dev` wrote it after our initial
    // loadEnvFiles() call (happens on first run with a fresh DB) — picks up
    // CONVEX_DEPLOYMENT and the CLI-allocated backend endpoints. Idempotent
    // with the adoption inside waitForConvex (external mode skips that one).
    adoptCliEndpointsFromEnvLocal();

    // Load the local deployment's admin key now that `convex dev` has written
    // it — enables the WebDAV /dav/* route in dev. External backends supply
    // ADMIN_KEY via .env instead (no local config file to read).
    if (!useExternalConvex) {
      ensureLocalAdminKey();
    }

    // Download/resolve yt-dlp + deno + ffmpeg before the env sync so their paths
    // are in process.env when the explicit-key loop below pushes them to Convex.
    // Own step (own progress line) because a cold cache downloads two binaries.
    await runStep(
      {
        active: 'Provisioning video toolchain',
        done: 'Video toolchain ready',
      },
      provisionVideoToolchain,
    );

    try {
      await runStep(
        {
          active: 'Syncing environment to Convex',
          done: 'Environment synced to Convex',
        },
        async () => {
          await runCommand(
            'bun',
            ['scripts/sync-convex-env-from-dotenv.ts'],
            {},
            platformRoot,
            { label: 'env' },
          );

          // Sync the orchestrator-managed keys explicitly — each is set
          // dynamically (envNormalizeCommon / provisionVideoToolchain), not in
          // any .env file, and Convex reads them from the deployment env (else
          // new-org seeding falls back to the live `default` org, and the video
          // node action can't find yt-dlp/ffmpeg → chat video links fail).
          for (const key of [
            'TALE_CONFIG_DIR',
            'TALE_CONFIG_BUILTIN_DIR',
            'VIDEO_INGEST_BIN_DIR',
            'VIDEO_INGEST_FFMPEG_LOCATION',
            'VIDEO_INGEST_YTDLP_PLUGIN_DIRS',
          ]) {
            const value = process.env[key];
            if (value) {
              await runCommand(
                'npx',
                ['convex', 'env', 'set', `${key}=${value}`],
                {},
                platformRoot,
                { label: 'convex', classifier: convexClassifier },
              );
            }
          }
        },
      );
    } catch (err) {
      warnLine(
        `Env sync had errors: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // The pre-warm (`convex dev --once`) and the persistent `convex dev` both
    // write convex/_generated/, so a separate `convex codegen` is normally
    // redundant (and env vars don't affect generated types). Only run it as a
    // fallback if the generated output is somehow missing.
    const generatedApi = join(platformRoot, 'convex', '_generated', 'api.d.ts');
    if (!existsSync(generatedApi)) {
      await runStep(
        { active: 'Generating Convex types', done: 'Convex types generated' },
        () =>
          runCommand('npx', ['convex', 'codegen'], {}, platformRoot, {
            label: 'convex',
            classifier: convexClassifier,
          }),
      );
    }

    await runStep(
      { active: 'Waiting for auth routes', done: 'Auth routes ready' },
      () => waitForAuthRoutes(),
    );

    // Preserve any existing CONVEX_URL the user set (external mode); only
    // synthesize one for local mode where we own the spawned backend.
    const convexUrl =
      process.env.CONVEX_URL ||
      process.env.NEXT_PUBLIC_CONVEX_URL ||
      `http://${DEFAULT_CONVEX_HOST}:${DEFAULT_CONVEX_PORT}`;
    process.env.CONVEX_URL = convexUrl;
    // CONVEX_URL set for the Vite proxy (routine, no log).

    // #2631 mitigation: a rare local-backend boot race leaves the node action
    // executor unable to resolve its own extracted module while the backend
    // otherwise looks healthy (TCP up, auth OK) — nothing above this point
    // catches it, so a broken boot used to only surface ~15 minutes later as
    // opaque per-spec retries. Probe BEFORE Vite binds its port: Playwright's
    // webServer only watches the port, so failing (and exiting) here — instead
    // of after Vite is already reachable — is what turns this into an
    // immediate boot failure rather than a race with the first spec. E2E-only
    // (TALE_E2E, set by playwright.config.ts's webServer): `bun run dev`
    // shouldn't pay this extra round-trip. Root cause is NOT this probe's
    // job — see the issue for the boot-sequence investigation notes.
    if (isTruthy(process.env.TALE_E2E)) {
      await runStep(
        { active: 'Probing node executor', done: 'Node executor healthy' },
        () =>
          probeNodeExecutor({
            convexUrl,
            timeoutMs: DEV_GATES.nodeExecutor.timeoutMs,
          }),
      );
    }

    const port = String(appPort);

    // Prod-build serve mode (E2E): serve a production build via `vite preview`
    // instead of the dev server. `vite dev` transpiles on the fly, which is the
    // dominant CPU consumer — on the 4-vCPU CI runner it starved the local
    // Convex backend hard enough to blow its 1s function-execution timeout in
    // floods and flake the suite. A pre-built `dist/` removes that load: preview
    // just serves static assets and proxies Convex (see vite.config.ts
    // `preview.proxy` + the plugins' `configurePreviewServer` hooks). Gated to
    // E2E so `bun run dev` keeps its HMR loop.
    const serveBuild = isTruthy(process.env.TALE_E2E_SERVE_BUILD);

    if (serveBuild) {
      const distIndex = join(platformRoot, 'dist', 'index.html');
      if (!existsSync(distIndex)) {
        await runStep(
          {
            active: 'Building production bundle',
            done: 'Production bundle built',
          },
          () =>
            runCommand('bun', ['--bun', 'vite', 'build'], {}, platformRoot, {
              label: 'vite',
              classifier: viteClassifier,
            }),
        );
      } else {
        infoLine('Reusing existing dist/ (skipping vite build)');
      }
      // No `--bun`: preview proxies Convex (preview.proxy in vite.config.ts),
      // and Vite 7's proxy calls `socket.destroySoon`, which Bun 1.3.x's
      // runtime lacks — the same reason `vite dev` runs on Node below.
      viteProcess = spawn(
        'bun',
        [
          'vite',
          'preview',
          '--port',
          port,
          '--strictPort',
          '--host',
          '0.0.0.0',
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: platformRoot,
          env: process.env,
        },
      );
      pipeChild(viteProcess, {
        label: 'vite',
        classifier: viteClassifier,
        mode: 'errors',
      });
    } else {
      // Run Vite on Node.js (no --bun flag): Bun 1.3.x lacks socket.destroySoon,
      // which Vite 7's dev proxy requires. Build/preview still use --bun.
      // `--strictPort`: if 3000 is taken, FAIL loudly instead of silently moving
      // to the next free port (which would break SITE_URL, the Convex proxy, and
      // every "localhost:3000" message). The assertPortFree() preflight above
      // catches this earlier with a friendlier message; this is the safety net.
      viteProcess = spawn(
        'bun',
        ['vite', 'dev', '--port', port, '--strictPort', '--host', '0.0.0.0'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: platformRoot,
          env: process.env,
        },
      );
      pipeChild(viteProcess, {
        label: 'vite',
        classifier: viteClassifier,
        mode: 'errors',
      });
    }

    // Print one unmistakable READY banner once Vite has actually bound the
    // port — the messages above only promise the URL.
    void announceWhenReady(appPort, appUrl);

    async function shutdown() {
      if (shuttingDown) {
        // Second Ctrl-C — don't wait for the graceful path, quit immediately.
        process.exit(1);
      }
      shuttingDown = true;

      if (healthCheckTimer) clearInterval(healthCheckTimer);

      infoLine('Shutting down');

      // Safety net: never hang on a child that refuses to die — force-exit
      // after 3s so a single Ctrl-C is always enough.
      const forceExit = setTimeout(() => process.exit(1), 3000);
      forceExit.unref();

      await Promise.all([
        killProcessTree(convexProcess, 'SIGTERM'),
        killProcessTree(viteProcess, 'SIGTERM'),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 500));

      infoLine('All processes stopped');
      process.exit(0);
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    viteProcess.on('exit', (code) => {
      if (shuttingDown) return;
      infoLine(`Vite dev server exited with code ${code}`);
      void shutdown();
    });

    startHealthCheck();

    await new Promise(() => {});
  } catch (err) {
    errorLine(
      `Development environment failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

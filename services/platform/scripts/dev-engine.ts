/*
  Dev orchestrator for `bun run dev` (and `tale dev`'s host mode).

  What it runs, in order:
   1) The docker backing services this host loop depends on (db, knowledge-db,
      the LLM gateway, the sandbox tier) with the dev overlays.
   2) The video toolchain (yt-dlp + deno + ffmpeg), resolved into the env the
      backend inherits.
   3) The BACKEND — the same `backend/main.ts` entry the container runs, in
      role `all` (api + worker in one process) — supervised by a health probe
      that restarts it up to a cap.
   4) Vite (dev server, or `vite preview` over a production build in E2E),
      proxying /api, /events and /dav to the backend.

  The restart/health DECISIONS live in `./backend-supervisor` as pure,
  exhaustively tested reducers; this file owns the effectful spawn/kill/probe
  wiring and the reporter output.
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

import {
  onBackendReady,
  onHealthTick,
  onRestartSettled,
  planRestart,
  type SupervisorState,
  SUPERVISOR_LIMITS,
} from './backend-supervisor';
import { DEV_GATES } from './dev-gates';
import { isTruthy, shouldOpenBrowser } from './dev-modes';
import {
  backendClassifier,
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

const platformRoot = join(import.meta.dir, '..');
const repoRoot = join(import.meta.dir, '..', '..', '..');

// Wall-clock boot start, so the orchestrator can show how long each phase took.
// A cold boot is dominated by docker bring-up + the toolchain fetch — surfacing it turns an opaque
// wait into a measurable number.
const BOOT_STARTED_AT = Date.now();
const sinceBoot = (): string =>
  `${((Date.now() - BOOT_STARTED_AT) / 1000).toFixed(1)}s`;

// Docker backing services the HOST `bun dev` depends on (the backend + Vite
// run on the host; these run in docker). Excludes the host-run backend and the
// dev-irrelevant proxy/docs. `sandbox-llm-gateway` is the one with no
// published port in base compose.yml — see DEV_COMPOSE_FILES.
//
// compose.sandbox-llm-gateway.dev.yml
// (host bun-dev only) drops that edge via `!override` — the host backend owns
// config here — so this bring-up does NOT pull up a redundant backend
// container alongside the host one.
const DEV_DOCKER_SERVICES = [
  'db',
  // ParadeDB for the knowledge base / RAG search corpus (formerly the separate
  // rag + crawler services, consolidated into the tale-db image — see the
  // knowledge-db migration wiring).
  'knowledge-db',
  // The blob store. S3-compatible storage is the ONLY blob backend, so
  // without this every upload in the dev stack fails closed — the host
  // backend seeds the deployment-default connection against it at boot.
  'object-store',
  'sandbox-llm-gateway',
  'sandbox',
  'sandbox-egress',
  // socat relay aliased `backend-api` on the sandbox net → the host-run
  // backend, so the in-container tool + connector bridges reach its doors
  // (the `--internal` sandbox net can't otherwise reach the host).
  'backend-relay',
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

  if (!process.env.SITE_URL) {
    process.env.SITE_URL = `http://${host}${host === 'localhost' ? `:${port}` : ''}`;
  }

  // Sandbox → backend reachability. These URLs are fetched by the SESSION
  // CONTAINER's daemon (not the spawner), which sits on the `--internal`
  // sandbox net and whose undici fetch ignores the egress proxy — so it can
  // only reach hosts ON that network. In `bun dev` the backend runs on the
  // host, so the `backend-relay` socat (compose.dev.yml) carries the
  // `backend-api` alias there. (`host.docker.internal` resolves for the
  // spawner but NOT for session containers, which is why it never worked for
  // storage staging.)
  //
  // Override in `services/platform/.env.local` only for a non-standard topology.
  if (!process.env.SANDBOX_HTTP_API_BASE_URL) {
    process.env.SANDBOX_HTTP_API_BASE_URL = 'http://backend-api:3005';
  }

  // Writable per-org config ROOT (org-first: `<root>/<orgSlug>/<domain>/`).
  // The backend derives its sub-dirs from TALE_CONFIG_DIR.
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
  // of this root. Prod sets this in the image (services/platform/Dockerfile
  // copies the catalog → /app/builtin and sets the env). Dev has no build
  // step, so default it to the repo's tracked
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

// The video toolchain the ingest lane spawns.
//
// Production BAKES those binaries into the platform image on
// pinned paths; a host `bun dev` backend has neither, so ingestion used to fail
// "yt-dlp binary not found" until the operator hand-set VIDEO_INGEST_* (#2746).
// Reuse the SAME self-provisioner the live YouTube test uses — download yt-dlp +
// deno into a per-user cache, resolve ffmpeg — and export the paths the node
// action reads (VIDEO_INGEST_BIN_DIR / _FFMPEG_LOCATION / _YTDLP_PLUGIN_DIRS).
// The explicit-value-wins rule (only fill gaps) lets a self-hoster pin their own
// baked paths. Best-effort: a download/network failure warns and continues —
// video ingestion is optional and the rest of the stack must still boot. The
// backend inherits the exported vars from this process.
async function provisionVideoToolchain(): Promise<void> {
  // The hermetic E2E stack (TALE_E2E, set by playwright.config.ts's webServer
  // and the CI workflow) exercises no video ingestion — but on a bare CI
  // runner this step apt-installs ffmpeg, and a slow mirror has eaten the
  // whole 300s webServer boot budget (shards died mid-`apt-get`). Skip it
  // there, like the docker bring-up (TALE_DEV_SKIP_DOCKER).
  if (process.env.TALE_E2E === '1') {
    infoLine('Skipping video toolchain (TALE_E2E set — no video specs)');
    return;
  }
  if (
    process.env.VIDEO_INGEST_BIN_DIR &&
    process.env.VIDEO_INGEST_FFMPEG_LOCATION
  ) {
    return; // Operator pinned both — respect it, skip the download.
  }
  try {
    const { ensureVideoToolchain } =
      await import('../backend/core/video_links/ytdlp_toolchain');
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

  // Container-only config paths must not reach a HOST run's process env. The
  // repo-root `.env` doubles as docker compose's env_file, so it carries
  // container paths (`TALE_CONFIG_DIR=/app/data`); Bun also auto-loads that
  // file, making the value look like an explicit shell override. Drop such a
  // value from process.env BEFORE the gap-fill below (so a real platform
  // `.env` override can land), and never fill one from the merged files
  // (envNormalizeCommon's host default then applies). Inside a container
  // `/app` exists and everything passes through untouched.
  const containerOnly = (value: string | undefined): boolean =>
    !existsSync('/app') &&
    value !== undefined &&
    (value === '/app' || value.startsWith('/app/'));
  for (const key of ['TALE_CONFIG_DIR', 'TALE_CONFIG_BUILTIN_DIR']) {
    if (containerOnly(process.env[key])) {
      warnLine(
        `${key}=${process.env[key]} is a container path (repo-root .env ` +
          `serves docker compose) — ignoring it for this host run.`,
      );
      delete process.env[key];
    }
    if (containerOnly(mergedEnv[key])) {
      delete mergedEnv[key];
    }
  }

  // Same guard for the spawner URL: `http://sandbox:8003` is the in-compose
  // alias (compose and the platform entrypoint default it themselves), and
  // `sandbox` resolves only on the compose network. A host backend
  // inheriting it dies on every agent start with `TypeError: fetch failed`
  // (getaddrinfo ENOTFOUND sandbox) — drop it so session_client's host
  // default (http://localhost:8003) applies.
  const composeOnlySandboxUrl = (value: string | undefined): boolean =>
    !existsSync('/app') &&
    value !== undefined &&
    URL.canParse(value) &&
    new URL(value).hostname === 'sandbox';
  if (composeOnlySandboxUrl(process.env.SANDBOX_URL)) {
    warnLine(
      `SANDBOX_URL=${process.env.SANDBOX_URL} is the in-compose alias ` +
        `(repo-root .env serves docker compose) — ignoring it for this ` +
        `host run.`,
    );
    delete process.env.SANDBOX_URL;
  }
  if (composeOnlySandboxUrl(mergedEnv.SANDBOX_URL)) {
    delete mergedEnv.SANDBOX_URL;
  }

  // And for the in-sandbox backend origin: `convex` is the RETIRED 0.4
  // alias — the 0.5 sandbox net serves the backend as `backend-api` (the
  // socat relay on a host run, the api container itself under compose), so
  // a `http://convex:3211` left in a dotenv file dead-ends every staging
  // fetch and bridge call. Drop it so the host default below applies.
  const retiredConvexAlias = (value: string | undefined): boolean =>
    value !== undefined &&
    URL.canParse(value) &&
    new URL(value).hostname === 'convex';
  if (retiredConvexAlias(process.env.SANDBOX_HTTP_API_BASE_URL)) {
    warnLine(
      `SANDBOX_HTTP_API_BASE_URL=${process.env.SANDBOX_HTTP_API_BASE_URL} ` +
        `names the retired 0.4 \`convex\` alias — ignoring it (the 0.5 ` +
        `sandbox net serves the backend as backend-api).`,
    );
    delete process.env.SANDBOX_HTTP_API_BASE_URL;
  }
  if (retiredConvexAlias(mergedEnv.SANDBOX_HTTP_API_BASE_URL)) {
    delete mergedEnv.SANDBOX_HTTP_API_BASE_URL;
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

/**
 * The step helpers currently running under {@link runCommand} — `docker
 * compose up`, `wait-on`, `vite build`. `shutdown()` tree-kills them with the
 * backend and Vite: a SIGTERM that lands during `waitForBackend` used to leave
 * `bunx wait-on tcp:127.0.0.1:3005` polling for its full 180 s timeout after
 * the orchestrator was gone.
 */
const stepChildren = new Set<ChildProcess>();

function runCommand(
  cmd: string,
  args: string[],
  env: Record<string, string> = {},
  cwd: string = platformRoot,
  output: { label?: string; classifier?: Classifier } = {},
) {
  return new Promise<void>((resolve, reject) => {
    // Capture (not inherit) so the raw subprocess firehose — docker pull/build
    // layers, boot chatter — is classified and collapsed
    // to clean status instead of dumped to the terminal. A failing step prints
    // its captured tail before rejecting, so the cause is never silently lost.
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      env: { ...process.env, ...env },
    });
    stepChildren.add(child);
    const piped = pipeChild(child, {
      label: output.label ?? cmd,
      classifier: output.classifier,
    });
    child.on('exit', (code) => {
      stepChildren.delete(child);
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
    child.on('error', (err) => {
      stepChildren.delete(child);
      reject(err);
    });
  });
}

// The restart/health thresholds live with the (tested) state machine in
// `./backend-supervisor`; the orchestrator only needs them for its probe timer
// and user-facing messages.
const {
  HEALTH_CHECK_INTERVAL_MS,
  HEALTH_CHECK_TIMEOUT_MS,
  MAX_CONSECUTIVE_FAILURES,
  MAX_AUTO_RESTARTS,
} = SUPERVISOR_LIMITS;

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
 *  dev overlays. Host bun dev runs the backend + Vite on the host, but the LLM
 *  gateway, sandbox spawner, db and knowledge-db run in docker. The base
 *  compose.yml publishes NO gateway port (prod posture) — only
 *  compose.sandbox-llm-gateway.dev.yml maps 127.0.0.1:8080 — so a plain `docker compose
 *  up` silently drops the loopback binding and the host backend can't
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
 *  side-effects and let the app come up anyway (pure frontend work
 *  doesn't need it). */
async function ensureDockerDependencies(): Promise<void> {
  // The hermetic E2E stack (playwright.config.ts) is a local backend + mock
  // LLM with "no external services" — the backing images aren't built in the
  // E2E CI job, so `docker compose up` can only ever fail there. Attempting it
  // wastes the cold-boot budget and destabilizes the boot that
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
  // like sandbox-llm-gateway/backend-relay are never built, so they stay put — which is
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
      // services defined-but-not-started here (platform/proxy/docs) are
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
      // non-fatal — degrade to `[ ! ]` and continue (pure frontend work
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

/** Probe the Better Auth surface until `/api/auth/ok` answers 200 — a true
 *  end-to-end readiness check: it proves the routes are mounted AND the
 *  handler can execute with its env (BETTER_AUTH_SECRET etc.). On the FIRST
 *  run in a clean repo the browser used to race this bootstrap — the page's
 *  initial session fetch failed, the auth provider latched the failure, and
 *  the app sat in skeletons until a manual reload. Probing before Vite starts
 *  means the app is never reachable before auth is. Warn-and-continue on
 *  timeout: a genuinely broken auth route fails loudly in the browser anyway,
 *  and the client retries transient failures. */
async function waitForAuthRoutes(
  timeoutMs = DEV_GATES.authOk.timeoutMs,
): Promise<void> {
  const base = (
    process.env.TALE_BACKEND_URL || 'http://127.0.0.1:3005'
  ).replace(/\/$/, '');
  const url = `${base}/api/auth/ok`;
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
 *  SLOWEST to start (it waits on the backend), coming up ~20-60s after
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
  infoLine('Starting Tale dev environment');

  let backendProcess: ChildProcess | null = null;
  let viteProcess: ChildProcess | null = null;
  let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  let shuttingDown = false;
  let restartCount = 0;
  let backendReadyAt = 0;
  let consecutiveFailures = 0;
  let restarting = false;

  // The restart/health DECISIONS live in the pure, tested reducers in
  // `./backend-supervisor`; these two helpers snapshot the orchestrator's
  // mutable state into the reducer and write the result back. `shuttingDown`
  // is owned by `shutdown()` (the reducers only read it), so it is never
  // written back here.
  const snapshot = (): SupervisorState => ({
    restartCount,
    backendReadyAt,
    consecutiveFailures,
    restarting,
    shuttingDown,
  });
  const applyState = (s: SupervisorState): void => {
    restartCount = s.restartCount;
    backendReadyAt = s.backendReadyAt;
    consecutiveFailures = s.consecutiveFailures;
    restarting = s.restarting;
  };

  /**
   * Stop every child — backend, Vite and any step helper still running — and
   * exit. Tolerates children that were never spawned (`killProcessTree`
   * null-guards), so it is safe from the first line of the bring-up: the
   * signal handlers below are registered BEFORE the docker, backend and Vite
   * steps, because a SIGTERM that lands while the backend is still booting
   * used to kill only the orchestrator (default signal action) and leave
   * `node backend/main.ts` holding :3005 for the next `bun run dev` to trip
   * over.
   */
  async function shutdown(exitCode = 0): Promise<never> {
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
      killProcessTree(backendProcess, 'SIGTERM'),
      killProcessTree(viteProcess, 'SIGTERM'),
      ...[...stepChildren].map((child) => killProcessTree(child, 'SIGTERM')),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 500));

    infoLine('All processes stopped');
    process.exit(exitCode);
  }

  // Not `process.on('SIGINT', shutdown)`: the signal name would arrive as
  // the exit code.
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  try {
    loadEnvFiles();
    // Re-configure the reporter now that .env is loaded, so a NO_COLOR /
    // FORCE_COLOR / CI set there is honored (the import-time probe ran before
    // the dotenv files were read). Same single source `tale` configures.
    configureReporter(detectCapabilities());

    envNormalizeCommon();
    deriveDevSecrets(process.env);

    // Port + URL are fully resolved now (envNormalizeCommon set PORT/SITE_URL),
    // so derive the app's address from those — honouring PORT/SITE_URL
    // overrides instead of hardcoding localhost:3000.
    const appPort = Number(process.env.PORT || '3000');
    const appUrl = process.env.SITE_URL || `http://localhost:${appPort}`;

    // Fail fast if the app's port is taken — otherwise Vite silently moves to
    // another port and every "${appUrl}" message we print becomes a lie.
    await assertPortFree(appPort);

    // Bring up the docker backing stack (gateway, sandbox, db, knowledge-db)
    // WITH the dev overlays before the backend and Vite. `bun dev` runs the
    // backend + Vite on the HOST but depends on those in docker; the LLM
    // gateway in particular has no published port in base compose.yml, so
    // without this an external agent turn dies with "fetch failed".
    // Non-fatal if docker is absent (warns + continues).
    await ensureDockerDependencies();

    // yt-dlp + deno + ffmpeg, resolved before the backend starts so their
    // paths are in the environment it inherits (the ingest lane spawns them).
    // Own step because a cold cache downloads two binaries.
    await runStep(
      { active: 'Provisioning video toolchain', done: 'Video toolchain ready' },
      provisionVideoToolchain,
    );

    const backendPort = Number(process.env.BACKEND_PORT || '3005');
    process.env.TALE_BACKEND_URL ??= `http://127.0.0.1:${backendPort}`;

    function spawnBackend() {
      // The SAME entry the container runs (role `all`: api + worker in one
      // process), so dev and prod exercise one boot path — including the
      // node-loader that lets it import the shared pure modules unchanged.
      backendProcess = spawn(
        'node',
        [
          '--experimental-transform-types',
          '--disable-warning=ExperimentalWarning',
          '--import',
          join(platformRoot, 'backend', 'node-loader.mjs'),
          join(platformRoot, 'backend', 'main.ts'),
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: platformRoot,
          env: { ...process.env, TALE_ROLE: 'all', PORT: String(backendPort) },
        },
      );
      pipeChild(backendProcess, {
        label: 'backend',
        classifier: backendClassifier,
        mode: 'errors',
      });
      backendProcess.on('exit', (code) => {
        if (shuttingDown || restarting) return;
        infoLine(`Backend exited with code ${code}`);
        void shutdown();
      });
    }

    async function waitForBackend() {
      try {
        await runCommand('bunx', [
          'wait-on',
          `tcp:127.0.0.1:${backendPort}`,
          '--timeout',
          String(DEV_GATES.backendTcp.timeoutMs),
          '--interval',
          '250',
        ]);
      } catch (err) {
        throw new Error(
          `The backend did not start on 127.0.0.1:${backendPort} in time. Is another one holding the port (lsof -i :${backendPort}), or is the database unreachable? Underlying: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      applyState(onBackendReady(snapshot(), Date.now()));
    }

    async function restartBackend() {
      const plan = planRestart(snapshot(), Date.now());
      if (plan.action === 'noop') return;
      applyState(plan.state);

      if (plan.action === 'shutdown-cap') {
        errorLine(
          `The backend failed ${MAX_AUTO_RESTARTS} times in quick succession, shutting down`,
        );
        void shutdown();
        return;
      }

      warnLine(
        `Backend unresponsive, restarting (attempt ${restartCount}/${MAX_AUTO_RESTARTS})`,
      );
      try {
        await killProcessTree(backendProcess, 'SIGKILL');
        spawnBackend();
        await waitForBackend();
        doneLine('Backend recovered');
      } catch (err) {
        errorLine(
          `Backend failed to recover: ${err instanceof Error ? err.message : String(err)}`,
        );
        applyState(onRestartSettled(snapshot()));
        void shutdown();
        return;
      }
      applyState(onRestartSettled(snapshot()));
    }

    function startHealthCheck() {
      healthCheckTimer = setInterval(async () => {
        // Don't even probe while a restart/shutdown is in flight (the reducer
        // would also no-op, but skipping the probe avoids a redundant socket).
        if (shuttingDown || restarting) return;

        const alive = await tcpProbe(
          '127.0.0.1',
          backendPort,
          HEALTH_CHECK_TIMEOUT_MS,
        );
        const childAlive = !(
          backendProcess?.killed || backendProcess?.exitCode != null
        );
        const tick = onHealthTick(snapshot(), { alive, childAlive });
        applyState(tick.state);

        if (tick.action === 'warn') {
          warnLine(
            `Backend health check failed on :${backendPort} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`,
          );
        } else if (tick.action === 'restart') {
          warnLine(
            `Backend health check failed on :${backendPort} (${MAX_CONSECUTIVE_FAILURES}/${MAX_CONSECUTIVE_FAILURES})`,
          );
          void restartBackend();
        }
      }, HEALTH_CHECK_INTERVAL_MS);

      healthCheckTimer.unref();
    }

    // One live line for the whole backend bring-up: boot migrations run
    // inside the process (advisory-locked), so "listening" is the ready
    // signal.
    await runStep(
      { active: 'Starting backend', done: 'Backend started' },
      async () => {
        spawnBackend();
        await waitForBackend();
      },
    );

    await runStep(
      { active: 'Waiting for auth routes', done: 'Auth routes ready' },
      () => waitForAuthRoutes(),
    );

    const port = String(appPort);

    // Prod-build serve mode (E2E): serve a production build via `vite preview`
    // instead of the dev server. `vite dev` transpiles on the fly, which is the
    // dominant CPU consumer on a small CI runner; a pre-built `dist/` removes
    // that load (preview just serves static assets and proxies the backend —
    // see vite.config.ts `preview.proxy`). Gated to E2E so `bun run dev` keeps
    // its HMR loop.
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
      // No `--bun`: preview proxies the backend, and Vite 7's proxy calls
      // `socket.destroySoon`, which Bun 1.3.x's runtime lacks — the same
      // reason `vite dev` runs on Node below.
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
      // Run Vite on Node.js (no --bun flag): Bun 1.3.x lacks
      // socket.destroySoon, which Vite 7's dev proxy requires. Build/preview
      // still use --bun. `--strictPort`: if 3000 is taken, FAIL loudly instead
      // of silently moving to the next free port (which would break SITE_URL,
      // the proxy, and every "localhost:3000" message).
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

    viteProcess.on('exit', (code) => {
      if (shuttingDown) return;
      infoLine(`Vite dev server exited with code ${code}`);
      void shutdown();
    });

    startHealthCheck();

    await new Promise(() => {});
  } catch (err) {
    // A step helper that `shutdown()` just killed rejects its step too (the
    // wait-on timeout wording, mid-Ctrl-C): the signal path owns that exit,
    // so it is not a boot failure to report.
    if (shuttingDown) return;
    errorLine(
      `Development environment failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    // A child spawned before the failure — a backend still waiting on its
    // database when waitForBackend gave up, or Vite — must not outlive the
    // orchestrator: it would bind :3005 later and the next `bun run dev`
    // would fail at waitForBackend blaming "another one holding the port".
    await shutdown(1);
  }
}

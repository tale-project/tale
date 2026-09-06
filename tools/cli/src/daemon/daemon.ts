/**
 * The daemon main loop:
 *
 *   register → [poll claim → execute → report] with server-driven pacing.
 *
 * Pacing: the claim response carries `retryAfterMs` (3s after work was
 * handed out, 15s idle); after ten idle minutes the client escalates its
 * own cap to 60s, so a forgotten daemon costs ~1 request/min. While a run
 * executes, a 15s heartbeat renews the server lease and picks up
 * cancellation requests (→ SIGTERM to the CLI). One run executes at a time
 * — org/agent parallelism is the server's concurrency-cap job, not ours.
 */

import { spawn } from 'node:child_process';

import { detectAdapters, getAdapter } from './adapters/index';
import type { AdapterDetection } from './adapters/types';
import {
  ApiAuthError,
  RateLimitedError,
  TaleApi,
  type ClaimedWork,
} from './api';
import { effectivePermission, type DaemonConfig } from './config';
import {
  collectDiffStat,
  prepareWorkspace,
  resolveWorkspacePath,
} from './workspace';

const HEARTBEAT_ACTIVE_MS = 15_000;
const HEARTBEAT_IDLE_MS = 30_000;
const IDLE_ESCALATION_AFTER_MS = 10 * 60 * 1000;
const IDLE_MAX_POLL_MS = 60_000;
/** Fallback wall-clock budget when the server sends a bogus timeout. */
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_RUN_TIMEOUT_MS = 60_000;

function log(message: string): void {
  console.log(`[tale-daemon] ${new Date().toISOString()} ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The local kill-timer is `serverBudget - 60s` so the server's deadline wins
 * cleanly. A 0/negative/NaN server budget would otherwise make every run time
 * out instantly, so fall back to a sane default and never drop below the floor.
 */
function resolveTimeoutMs(serverTimeoutMs: number): number {
  const budget =
    Number.isFinite(serverTimeoutMs) && serverTimeoutMs > 0
      ? serverTimeoutMs
      : DEFAULT_RUN_TIMEOUT_MS;
  return Math.max(MIN_RUN_TIMEOUT_MS, budget - 60_000);
}

interface ExecResult {
  stdout: string;
  code: number | null;
  cancelled: boolean;
  timedOut: boolean;
  /**
   * The child never started (ENOENT: adapter binary missing; E2BIG: the
   * prompt overflowed argv; EACCES…). Distinct from a non-zero exit — a run
   * that cannot start on this daemon will not start on a retry either.
   */
  spawnError?: string;
}

/** How a finished adapter run is reported to the server. */
export function describeRunFailure(
  result: Pick<ExecResult, 'stdout' | 'code' | 'spawnError'>,
): { message: string; retryable: boolean } | null {
  if (result.spawnError !== undefined) {
    return {
      message: `CLI could not be started: ${result.spawnError}`,
      retryable: false,
    };
  }
  if (result.code !== 0) {
    return {
      message: `CLI exited with code ${result.code}: ${result.stdout.slice(-400)}`,
      retryable: true,
    };
  }
  return null;
}

function execAdapter(args: {
  command: string;
  argv: string[];
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
  onCancelCheck: (kill: () => void) => () => void;
}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(args.command, args.argv, {
      cwd: args.cwd,
      env: { ...process.env, ...args.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let cancelled = false;
    let timedOut = false;
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
      if (stdout.length > 4_000_000) stdout = stdout.slice(-2_000_000);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    const kill = () => {
      cancelled = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, args.timeoutMs);
    timer.unref();
    const stopCancelWatch = args.onCancelCheck(kill);

    child.on('close', (code) => {
      clearTimeout(timer);
      stopCancelWatch();
      resolve({ stdout, code, cancelled: cancelled && !timedOut, timedOut });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      stopCancelWatch();
      console.error('[tale-daemon] spawn failed', error);
      resolve({
        stdout,
        code: -1,
        cancelled: false,
        timedOut: false,
        spawnError: error.message,
      });
    });
  });
}

async function executeRun(
  api: TaleApi,
  config: DaemonConfig,
  work: ClaimedWork,
): Promise<void> {
  const adapter = getAdapter(work.adapterType);
  if (!adapter) {
    await api.fail(
      work.externalRunId,
      `unknown adapter ${work.adapterType}`,
      false,
    );
    return;
  }
  const basePath = resolveWorkspacePath(config, work.workspaceKey);
  if (!basePath) {
    await api.fail(
      work.externalRunId,
      `no workspace configured${work.workspaceKey ? ` for key "${work.workspaceKey}"` : ''}`,
      false,
    );
    return;
  }

  const workspace = await prepareWorkspace(basePath, work.externalRunId);
  const permission = effectivePermission(
    work.permissionMode,
    config.permissionCeiling,
  );
  log(
    `run ${work.externalRunId} adapter=${work.adapterType} permission=${permission} cwd=${workspace.cwd}`,
  );

  // All three v1 adapters take the prompt as an argument. argv length limits
  // are real: a prompt that overflows them fails the spawn with E2BIG, which
  // is reported below as a non-retryable start failure.
  const invocation = adapter.buildInvocation({
    prompt: work.prompt,
    permissionMode: permission,
    resumeSessionRef:
      work.kind === 'revision' && adapter.capabilities.sessionResume
        ? work.resumeSessionRef
        : undefined,
  });

  await api.sendEvent(work.externalRunId, 'started');

  // While the CLI runs: heartbeat (lease renewal) + cancellation watch.
  let stopRequested: (() => void) | null = null;
  const heartbeatLoop = setInterval(() => {
    void api
      .heartbeat()
      .then(({ cancel }) => {
        if (cancel.includes(work.externalRunId)) stopRequested?.();
        return null;
      })
      .catch((error) => {
        console.warn('[tale-daemon] heartbeat during run failed', error);
      });
  }, HEARTBEAT_ACTIVE_MS);

  const result = await execAdapter({
    command: invocation.command,
    argv: invocation.args,
    cwd: workspace.cwd,
    timeoutMs: resolveTimeoutMs(work.timeoutMs),
    // Agent-declared env first, then the adapter's own env (which wins on a
    // name collision — never let user config clobber the adapter's wiring).
    env: { ...work.env, ...invocation.env },
    onCancelCheck: (kill) => {
      stopRequested = kill;
      return () => {
        stopRequested = null;
      };
    },
  });
  clearInterval(heartbeatLoop);

  if (result.cancelled) {
    await api.fail(work.externalRunId, 'cancelled by server request', false);
    return;
  }
  if (result.timedOut) {
    await api.fail(work.externalRunId, 'CLI run timed out locally', false);
    return;
  }
  const failure = describeRunFailure(result);
  if (failure) {
    await api.fail(work.externalRunId, failure.message, failure.retryable);
    return;
  }

  const outcome = adapter.parseOutput(result.stdout);
  const diffStat = await collectDiffStat(workspace);
  await api.complete(work.externalRunId, {
    summary: outcome.summary,
    diffStat,
    sessionRef: outcome.sessionRef,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    costCents: outcome.costCents,
  });
  log(`run ${work.externalRunId} completed`);
}

export async function runDaemon(config: DaemonConfig): Promise<void> {
  const api = new TaleApi(config);
  const detections: AdapterDetection[] = await detectAdapters();
  if (detections.length === 0) {
    throw new Error(
      'No supported coding-agent CLIs found on PATH (claude, codex, opencode).',
    );
  }
  await api.register({
    adapters: detections,
    workspaceKeys: Object.keys(config.workspaces),
  });
  const adapterTypes = detections.map((d) => d.adapterType);
  log(
    `registered daemon=${config.daemonId} adapters=${adapterTypes.join(',')}`,
  );

  let idleSince = Date.now();
  let lastIdleHeartbeat = 0;
  // Object property (not a bare let) so the signal handlers' writes are
  // visible to the loop condition per eslint's loop analysis.
  const state = { stopping: false };
  process.on('SIGINT', () => {
    state.stopping = true;
    log('stopping after the current run…');
  });
  process.on('SIGTERM', () => {
    state.stopping = true;
  });

  while (!state.stopping) {
    try {
      const { run, retryAfterMs } = await api.claim(adapterTypes);
      if (run) {
        idleSince = Date.now();
        await executeRun(api, config, run);
        await sleep(retryAfterMs);
        continue;
      }
      // Idle: occasional heartbeat keeps the registry status fresh.
      if (Date.now() - lastIdleHeartbeat > HEARTBEAT_IDLE_MS) {
        lastIdleHeartbeat = Date.now();
        await api.heartbeat().catch((error) => {
          console.warn('[tale-daemon] idle heartbeat failed', error);
        });
      }
      const deepIdle = Date.now() - idleSince > IDLE_ESCALATION_AFTER_MS;
      await sleep(deepIdle ? IDLE_MAX_POLL_MS : retryAfterMs);
    } catch (error) {
      if (error instanceof ApiAuthError) throw error;
      if (error instanceof RateLimitedError) {
        await sleep(error.retryAfterMs);
        continue;
      }
      console.error('[tale-daemon] loop error', error);
      await sleep(15_000);
    }
  }
}

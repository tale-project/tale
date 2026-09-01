'use node';

/**
 * The out-of-process CodeRunner, bound to ONE sandbox session.
 *
 * `lib/engine/runners/sandbox-exec.ts` owns the whole wire protocol (program
 * assembly, scope delivery, result extraction); the one thing it leaves to the
 * host is a {@link SandboxProgramRunner} — "run this self-contained node
 * program in the sandbox under a hard deadline and report how it ended". This
 * module supplies it from a live session via the session client's one-shot
 * exec (`node -e <program>`, output collected, runnerd enforcing the kill on
 * overrun — the spawner reports that as `errorCode: 'TIMEOUT'`).
 *
 * PER-CALL, never global: the runner is handed to the dispatcher through its
 * per-invocation context (`ctx.codeRunner`), so two concurrent invocations
 * from different sessions/orgs can never share a transport — installing a
 * session-bound runner into the process-global `setCodeRunner` slot would be
 * a cross-tenant hazard.
 */

import { randomUUID } from 'node:crypto';

import type { CodeRunner } from '../../../../lib/engine/core/runner';
import {
  createSandboxExecRunner,
  createSessionTransport,
  type SandboxProgramRunner,
} from '../../../../lib/engine/runners/sandbox-exec';
import { drainSessionExecResilient } from './helpers/session_client';

/** An out-of-process boundary has a real payload ceiling; a connector body's
 * input/secrets/config fit comfortably in a fraction of this. */
const MAX_SCOPE_BYTES = 256 * 1024;

function fromBase64(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf8');
}

/** Run one self-contained node program in the session, one-shot. */
export function sandboxProgramRunnerForSession(
  sessionId: string,
): SandboxProgramRunner {
  return async (program, timeoutMs) => {
    const abort = new AbortController();
    const result = await drainSessionExecResilient(
      sessionId,
      {
        execId: randomUUID(),
        command: ['node', '-e', program],
        // The workspace root always exists; /agent/code only after staging.
        cwd: '/agent',
        collectOutput: true,
        timeoutMs,
      },
      abort.signal,
    );
    return {
      stdout: fromBase64(result.stdoutBase64),
      stderr: fromBase64(result.stderrBase64),
      exitCode: result.exitCode,
      timedOut: result.errorCode === 'TIMEOUT',
    };
  };
}

/** The sandbox-exec CodeRunner for one session — hand it to the dispatcher
 * via its per-invocation context. */
export function codeRunnerForSession(sessionId: string): CodeRunner {
  return createSandboxExecRunner(
    createSessionTransport(sandboxProgramRunnerForSession(sessionId)),
    { maxScopeBytes: MAX_SCOPE_BYTES },
  );
}

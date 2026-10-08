'use node';

/**
 * A sandbox session's one-shot program runner, the transport of the
 * out-of-process CodeRunner.
 *
 * `lib/engine/runners/sandbox-exec.ts` owns the whole wire protocol (program
 * assembly, scope delivery, result extraction); the one thing it leaves to the
 * host is a {@link SandboxProgramRunner} — "run this self-contained node
 * program in the sandbox under a hard deadline and report how it ended". This
 * module supplies it from a live session via the session client's one-shot
 * exec (`node -e <program>`, output collected, runnerd enforcing the kill on
 * overrun — the spawner reports that as `errorCode: 'TIMEOUT'`).
 *
 * Nothing runs a connector body this way any more (every live body runs on
 * the in-process runner, see the contract debt ledger); a runner built on it
 * must stay per call, never installed in the process-global `setCodeRunner`
 * slot two organizations share.
 */

import { randomUUID } from 'node:crypto';

import type { SandboxProgramRunner } from '../../../../lib/engine/runners/sandbox-exec';
import { drainSessionExecResilient } from './helpers/session_client';

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

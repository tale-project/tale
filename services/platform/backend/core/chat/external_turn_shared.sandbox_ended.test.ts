/**
 * How a terminal window the sandbox itself ended reads: an exec runnerd
 * ended as stalled (`EXEC_STALLED`) is named as such, with the harness's
 * last output, so each host settles it apart from a crash — unless the
 * harness had already ended its turn, whose own end stands. The crash
 * classification itself is unchanged: it is what the released legacy agent
 * flow still reads.
 */

import { describe, expect, it } from 'vitest';

import type { SessionExecResult } from '../node_only/sandbox/helpers/session_client';
import {
  classifyHarnessEnd,
  sandboxEndOf,
  STALLED_TURN_REASON,
} from './external_turn_shared';

function execResult(errorCode: string, exitCode: number): SessionExecResult {
  return {
    status: 'failed',
    exitCode,
    durationMs: 1,
    stdoutBase64: '',
    stderrBase64: '',
    truncated: { stdout: false, stderr: false },
    errorCode,
    errorMessage: 'ended by the sandbox',
  };
}

const quietWindow = {
  text: '',
  timeline: [],
  exited: true,
};

describe('sandboxEndOf', () => {
  it('names a stall, with what the harness printed last', () => {
    const window = {
      ...quietWindow,
      execResult: execResult('EXEC_STALLED', 143),
      stderrTail: 'waiting for input',
    };
    expect(sandboxEndOf(window)).toEqual({
      failure: 'stalled',
      reason: `${STALLED_TURN_REASON} Last output: waiting for input`,
    });
    // The crash reading it refines still fails the turn.
    expect(classifyHarnessEnd(window).errored).toBe(true);
  });

  it('names a stall without output by the stall alone', () => {
    expect(
      sandboxEndOf({
        ...quietWindow,
        execResult: execResult('EXEC_STALLED', 143),
      })?.reason,
    ).toBe(STALLED_TURN_REASON);
  });

  it('keeps a turn the harness ended itself', () => {
    const window = {
      ...quietWindow,
      text: 'Done.',
      execResult: execResult('EXEC_STALLED', 143),
      ended: {
        type: 'turn-ended' as const,
        status: 'completed' as const,
        finalText: 'Done.',
      },
    };
    expect(sandboxEndOf(window)).toBeUndefined();
    expect(classifyHarnessEnd(window).errored).toBe(false);
  });

  it('reads nothing while the exec still runs, or for an ordinary crash', () => {
    expect(
      sandboxEndOf({
        ...quietWindow,
        exited: false,
        execResult: execResult('EXEC_STALLED', 143),
      }),
    ).toBeUndefined();
    expect(
      sandboxEndOf({
        ...quietWindow,
        execResult: execResult('RUNTIME_ERROR', 1),
      }),
    ).toBeUndefined();
  });
});

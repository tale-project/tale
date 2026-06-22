import { describe, expect, it } from 'vitest';

import {
  isRetryableExecutionError,
  isRotatableApiError,
} from './agent_run_outcome';

describe('isRetryableExecutionError', () => {
  describe('throws (retryable execution error)', () => {
    it('agent self-reported error + no summary (the 401 case, CLI exited 0)', () => {
      expect(
        isRetryableExecutionError({
          agentResultStatus: 'error',
          terminalStatus: 'completed', // exit 0 — must NOT be trusted
          summaryWritten: false,
        }),
      ).toBe(true);
    });

    it('agent self-reported error + no summary, with a non-zero exit too', () => {
      expect(
        isRetryableExecutionError({
          agentResultStatus: 'error',
          terminalStatus: 'failed',
          summaryWritten: false,
        }),
      ).toBe(true);
    });

    it('no result event seen + failed process exit (died before reporting)', () => {
      expect(
        isRetryableExecutionError({
          agentResultStatus: undefined,
          terminalStatus: 'failed',
          summaryWritten: false,
        }),
      ).toBe(true);
    });
  });

  describe('does not throw (genuine outcome / budget / has handoff)', () => {
    it('a run that wrote summary.md is always an outcome — even if it errored', () => {
      expect(
        isRetryableExecutionError({
          agentResultStatus: 'error',
          terminalStatus: 'failed',
          summaryWritten: true,
        }),
      ).toBe(false);
    });

    it('completed with an unfavorable verdict (no summary)', () => {
      expect(
        isRetryableExecutionError({
          agentResultStatus: 'completed',
          terminalStatus: 'completed',
          summaryWritten: false,
        }),
      ).toBe(false);
    });

    it('max-turns is a budget outcome, not an execution error', () => {
      expect(
        isRetryableExecutionError({
          agentResultStatus: 'max-turns',
          terminalStatus: 'completed',
          summaryWritten: false,
        }),
      ).toBe(false);
    });

    it('cancelled (user stop) is not retryable', () => {
      expect(
        isRetryableExecutionError({
          agentResultStatus: 'cancelled',
          terminalStatus: 'cancelled',
          summaryWritten: false,
        }),
      ).toBe(false);
    });

    it('a wall-clock timeout handoff is a budget outcome (no result event)', () => {
      expect(
        isRetryableExecutionError({
          agentResultStatus: undefined,
          terminalStatus: 'timeout',
          summaryWritten: false,
        }),
      ).toBe(false);
    });
  });
});

describe('isRotatableApiError', () => {
  it('true for rate-limit / overloaded / auth on the terminal result', () => {
    for (const status of [429, 529, 401]) {
      expect(
        isRotatableApiError({ isError: true, apiErrorStatus: status }),
      ).toBe(true);
    }
  });

  it('false for non-rotatable statuses and clean completions', () => {
    expect(isRotatableApiError({ isError: true, apiErrorStatus: 400 })).toBe(
      false,
    );
    expect(isRotatableApiError({ isError: true, apiErrorStatus: 500 })).toBe(
      false,
    );
    expect(isRotatableApiError({ isError: false, apiErrorStatus: 429 })).toBe(
      false,
    );
    expect(
      isRotatableApiError({ isError: undefined, apiErrorStatus: undefined }),
    ).toBe(false);
    expect(
      isRotatableApiError({ isError: true, apiErrorStatus: undefined }),
    ).toBe(false);
  });

  it('true on an early auth-abort with a rotatable status (no terminal fields)', () => {
    expect(
      isRotatableApiError({
        isError: undefined,
        apiErrorStatus: undefined,
        terminationReason: 'auth-abort',
        authAbortStatus: 401,
      }),
    ).toBe(true);
  });

  it('false on auth-abort carrying a non-rotatable status', () => {
    expect(
      isRotatableApiError({
        isError: undefined,
        apiErrorStatus: undefined,
        terminationReason: 'auth-abort',
        authAbortStatus: 400,
      }),
    ).toBe(false);
  });
});

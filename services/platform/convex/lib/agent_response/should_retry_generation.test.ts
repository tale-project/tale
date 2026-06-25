import { describe, it, expect } from 'vitest';

// These are pure functions — no mocks needed
import {
  endedOnHumanInputGate,
  shouldRetryGeneration,
  needsToolResultRetry,
} from './generate_response';

// Helper to create step-like objects matching AI SDK shape
function makeStep(opts: {
  toolCalls?: Array<{ toolName: string }>;
  text?: string;
}) {
  return opts;
}

describe('shouldRetryGeneration', () => {
  describe('non-retryable finish reasons', () => {
    it('returns false for finishReason "stop" with text', () => {
      const result = shouldRetryGeneration('stop', 'Hello world', [], false);
      expect(result).toEqual({
        retry: false,
        reason: 'non-retryable-finish-reason',
      });
    });

    it('returns false for finishReason "cancelled"', () => {
      const result = shouldRetryGeneration('cancelled', '', [], false);
      expect(result).toEqual({
        retry: false,
        reason: 'non-retryable-finish-reason',
      });
    });

    it('returns false for finishReason "timeout-recovery"', () => {
      const result = shouldRetryGeneration(
        'timeout-recovery',
        'Recovered text',
        [],
        false,
      );
      expect(result).toEqual({
        retry: false,
        reason: 'non-retryable-finish-reason',
      });
    });

    it('returns false for finishReason "timeout-recovery-failed"', () => {
      const result = shouldRetryGeneration(
        'timeout-recovery-failed',
        'Fallback',
        [],
        false,
      );
      expect(result).toEqual({
        retry: false,
        reason: 'non-retryable-finish-reason',
      });
    });

    it('returns false for finishReason "content-filter"', () => {
      const result = shouldRetryGeneration('content-filter', '', [], false);
      expect(result).toEqual({
        retry: false,
        reason: 'non-retryable-finish-reason',
      });
    });
  });

  describe('retryable finish reasons', () => {
    it('retries for finishReason "length"', () => {
      const result = shouldRetryGeneration(
        'length',
        'Partial text...',
        [],
        false,
      );
      expect(result).toEqual({
        retry: true,
        reason: 'finish-reason-length',
      });
    });

    it('retries for finishReason "tool-calls"', () => {
      const result = shouldRetryGeneration(
        'tool-calls',
        'Let me check...',
        [makeStep({ toolCalls: [{ toolName: 'search' }] })],
        false,
      );
      expect(result).toEqual({
        retry: true,
        reason: 'finish-reason-tool-calls',
      });
    });

    it('does not retry for finishReason "error"', () => {
      const result = shouldRetryGeneration('error', '', [], false);
      expect(result).toEqual({
        retry: false,
        reason: 'non-retryable-finish-reason',
      });
    });

    it('retries for finishReason "unknown"', () => {
      const result = shouldRetryGeneration('unknown', 'Some text', [], false);
      expect(result).toEqual({
        retry: true,
        reason: 'finish-reason-unknown',
      });
    });

    it('retries for finishReason "other"', () => {
      const result = shouldRetryGeneration('other', '', [], false);
      expect(result).toEqual({ retry: true, reason: 'finish-reason-other' });
    });

    it('retries for undefined finishReason', () => {
      const result = shouldRetryGeneration(undefined, 'Text', [], false);
      expect(result).toEqual({
        retry: true,
        reason: 'finish-reason-undefined',
      });
    });
  });

  describe('DeepSeek edge case: "stop" with empty tool result', () => {
    it('retries when finishReason is "stop" but text is empty with tool steps', () => {
      const steps = [
        makeStep({
          toolCalls: [{ toolName: 'search' }],
          text: 'Let me check...',
        }),
      ];
      const result = shouldRetryGeneration('stop', '', steps, false);
      expect(result).toEqual({
        retry: true,
        reason: 'stop-with-empty-tool-result',
      });
    });

    it('does not retry when finishReason is "stop" with text and tool steps', () => {
      const steps = [
        makeStep({ toolCalls: [{ toolName: 'search' }], text: 'Preamble' }),
        makeStep({ text: 'Here are the results...' }),
      ];
      const result = shouldRetryGeneration(
        'stop',
        'Here are the results...',
        steps,
        false,
      );
      expect(result).toEqual({
        retry: false,
        reason: 'non-retryable-finish-reason',
      });
    });
  });

  describe('human-input approval gate is terminal', () => {
    // Regression: `stopWhen: hasToolCall('request_human_input')` halts the loop
    // with finishReason 'tool-calls'; without this branch the continue/retry
    // path resumed past the gate and ran the whole task anyway (the researcher
    // barrelling past its plan-confirmation card).
    it('does not retry when the last step called request_human_input (tool-calls)', () => {
      const steps = [
        makeStep({ toolCalls: [{ toolName: 'update_todos' }] }),
        makeStep({ toolCalls: [{ toolName: 'request_human_input' }] }),
      ];
      const result = shouldRetryGeneration('tool-calls', '', steps, false);
      expect(result).toEqual({ retry: false, reason: 'awaiting-human-input' });
    });

    it('does not retry on the "stop" + empty-text gate halt either', () => {
      const steps = [
        makeStep({
          toolCalls: [{ toolName: 'request_human_input' }],
          text: '',
        }),
      ];
      const result = shouldRetryGeneration('stop', '', steps, false);
      expect(result).toEqual({ retry: false, reason: 'awaiting-human-input' });
    });

    it('still retries when request_human_input is only an EARLIER step', () => {
      // The model called the gate, then kept going on its own — that is NOT a
      // stopWhen halt, so the incomplete trailing tool call stays retryable.
      const steps = [
        makeStep({ toolCalls: [{ toolName: 'request_human_input' }] }),
        makeStep({ toolCalls: [{ toolName: 'web' }] }),
      ];
      const result = shouldRetryGeneration('tool-calls', '', steps, false);
      expect(result).toEqual({
        retry: true,
        reason: 'finish-reason-tool-calls',
      });
    });
  });

  describe('already-retried guard', () => {
    it('returns false when already retried, even for retryable finishReason', () => {
      const result = shouldRetryGeneration('length', 'Partial...', [], true);
      expect(result).toEqual({ retry: false, reason: 'already-retried' });
    });

    it('returns false when already retried with undefined finishReason', () => {
      const result = shouldRetryGeneration(undefined, '', [], true);
      expect(result).toEqual({ retry: false, reason: 'already-retried' });
    });

    it('returns false when already retried even for "stop" with empty tool result', () => {
      const steps = [makeStep({ toolCalls: [{ toolName: 'search' }] })];
      const result = shouldRetryGeneration('stop', '', steps, true);
      expect(result).toEqual({ retry: false, reason: 'already-retried' });
    });
  });
});

describe('needsToolResultRetry', () => {
  it('returns false when no steps', () => {
    expect(needsToolResultRetry('text', [])).toBe(false);
    expect(needsToolResultRetry('text', undefined)).toBe(false);
  });

  it('returns true when text is empty and steps exist', () => {
    expect(needsToolResultRetry('', [makeStep({})])).toBe(true);
    expect(needsToolResultRetry(undefined, [makeStep({})])).toBe(true);
  });

  it('returns false when text exists and no tool calls in steps', () => {
    expect(needsToolResultRetry('Response', [makeStep({ text: 'Hi' })])).toBe(
      false,
    );
  });
});

describe('endedOnHumanInputGate', () => {
  it('returns false for no steps', () => {
    expect(endedOnHumanInputGate([])).toBe(false);
    expect(endedOnHumanInputGate(undefined)).toBe(false);
  });

  it('returns true when the last step called request_human_input', () => {
    const steps = [
      makeStep({ toolCalls: [{ toolName: 'update_todos' }] }),
      makeStep({ toolCalls: [{ toolName: 'request_human_input' }] }),
    ];
    expect(endedOnHumanInputGate(steps)).toBe(true);
  });

  it('returns false when the gate call is not the last step', () => {
    const steps = [
      makeStep({ toolCalls: [{ toolName: 'request_human_input' }] }),
      makeStep({ toolCalls: [{ toolName: 'web' }] }),
    ];
    expect(endedOnHumanInputGate(steps)).toBe(false);
  });

  it('returns false for an ordinary tool call', () => {
    expect(
      endedOnHumanInputGate([makeStep({ toolCalls: [{ toolName: 'web' }] })]),
    ).toBe(false);
  });

  it('returns true when last step has tool calls (preamble-only)', () => {
    const steps = [
      makeStep({
        toolCalls: [{ toolName: 'search' }],
        text: 'Let me check...',
      }),
    ];
    expect(needsToolResultRetry('Let me check...', steps)).toBe(true);
  });

  it('returns true when last step has no text after tool calls', () => {
    const steps = [
      makeStep({ toolCalls: [{ toolName: 'search' }], text: 'Checking...' }),
      makeStep({ text: '' }),
    ];
    expect(needsToolResultRetry('Checking...', steps)).toBe(true);
  });

  it('returns false when last step has substantive text after tool calls', () => {
    const steps = [
      makeStep({ toolCalls: [{ toolName: 'search' }], text: 'Checking...' }),
      makeStep({ text: 'Here are the results of the search.' }),
    ];
    expect(
      needsToolResultRetry(
        'Checking...\nHere are the results of the search.',
        steps,
      ),
    ).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';

// These are pure functions — no mocks needed
import {
  endedOnHumanInputGate,
  shouldRetryGeneration,
  needsToolResultRetry,
} from './generate_response';
import { MAX_STEP_CAP_CONTINUES } from './retry_policy';

// Helper to create step-like objects matching AI SDK shape
function makeStep(opts: {
  toolCalls?: Array<{ toolName: string; invalid?: boolean }>;
  text?: string;
}) {
  return opts;
}

/** First evaluation of a turn: nothing retried, no continuation rounds yet. */
const FRESH = { anomalyRetried: false, stepCapRounds: 0 };

describe('shouldRetryGeneration', () => {
  describe('non-retryable finish reasons', () => {
    it('returns false for finishReason "stop" with text', () => {
      const result = shouldRetryGeneration('stop', 'Hello world', [], FRESH);
      expect(result).toEqual({
        retry: false,
        reason: 'non-retryable-finish-reason',
      });
    });

    it('returns false for finishReason "cancelled"', () => {
      const result = shouldRetryGeneration('cancelled', '', [], FRESH);
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
        FRESH,
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
        FRESH,
      );
      expect(result).toEqual({
        retry: false,
        reason: 'non-retryable-finish-reason',
      });
    });

    it('returns false for finishReason "content-filter"', () => {
      const result = shouldRetryGeneration('content-filter', '', [], FRESH);
      expect(result).toEqual({
        retry: false,
        reason: 'non-retryable-finish-reason',
      });
    });
  });

  describe('anomaly retries', () => {
    it('retries for finishReason "length"', () => {
      const result = shouldRetryGeneration(
        'length',
        'Partial text...',
        [],
        FRESH,
      );
      expect(result).toEqual({
        retry: true,
        reason: 'finish-reason-length',
        kind: 'anomaly',
      });
    });

    it('does not retry for finishReason "error"', () => {
      const result = shouldRetryGeneration('error', '', [], FRESH);
      expect(result).toEqual({
        retry: false,
        reason: 'non-retryable-finish-reason',
      });
    });

    it('retries for finishReason "unknown" with no output', () => {
      const result = shouldRetryGeneration('unknown', '', [], FRESH);
      expect(result).toEqual({
        retry: true,
        reason: 'finish-reason-unknown',
        kind: 'anomaly',
      });
    });

    it('retries for finishReason "other"', () => {
      const result = shouldRetryGeneration('other', '', [], FRESH);
      expect(result).toEqual({
        retry: true,
        reason: 'finish-reason-other',
        kind: 'anomaly',
      });
    });

    it('retries for undefined finishReason with no output', () => {
      const result = shouldRetryGeneration(undefined, '', [], FRESH);
      expect(result).toEqual({
        retry: true,
        reason: 'finish-reason-undefined',
        kind: 'anomaly',
      });
    });
  });

  describe('unlabelled finish with substantive text is accepted', () => {
    // Regression: an OpenRouter upstream streamed a COMPLETE answer but never
    // sent a `finish_reason`, so the openai-compatible adapter reported
    // 'other' (its streaming default). That says nothing about the text being
    // incomplete — retrying regenerated the whole answer behind a ⚠ retry
    // badge, duplicating the content and re-burning the full prompt.
    it('does not retry "other" when the final step has substantive text', () => {
      // Mirror of the incident: tool-call step, then a text-only final step.
      const steps = [
        makeStep({ toolCalls: [{ toolName: 'document_retrieve' }], text: '' }),
        makeStep({ text: 'A complete multi-paragraph interpretation.' }),
      ];
      const result = shouldRetryGeneration(
        'other',
        'A complete multi-paragraph interpretation.',
        steps,
        FRESH,
      );
      expect(result).toEqual({
        retry: false,
        reason: 'unlabelled-finish-with-substantive-text',
      });
    });

    it('does not retry "other" with text and no steps', () => {
      const result = shouldRetryGeneration(
        'other',
        'Direct answer.',
        [],
        FRESH,
      );
      expect(result).toEqual({
        retry: false,
        reason: 'unlabelled-finish-with-substantive-text',
      });
    });

    it('does not retry "unknown" with text', () => {
      const result = shouldRetryGeneration('unknown', 'Some text', [], FRESH);
      expect(result).toEqual({
        retry: false,
        reason: 'unlabelled-finish-with-substantive-text',
      });
    });

    it('does not retry undefined finishReason with text', () => {
      const result = shouldRetryGeneration(undefined, 'Text', [], FRESH);
      expect(result).toEqual({
        retry: false,
        reason: 'unlabelled-finish-with-substantive-text',
      });
    });

    it('still retries "other" when text is only a pre-tool preamble', () => {
      const steps = [
        makeStep({
          toolCalls: [{ toolName: 'search' }],
          text: 'Let me check...',
        }),
      ];
      const result = shouldRetryGeneration(
        'other',
        'Let me check...',
        steps,
        FRESH,
      );
      expect(result).toEqual({
        retry: true,
        reason: 'finish-reason-other',
        kind: 'anomaly',
      });
    });

    it('still retries "other" when the follow-up after tools is empty', () => {
      const steps = [
        makeStep({ toolCalls: [{ toolName: 'search' }], text: 'Checking...' }),
        makeStep({ text: '' }),
      ];
      const result = shouldRetryGeneration(
        'other',
        'Checking...',
        steps,
        FRESH,
      );
      expect(result).toEqual({
        retry: true,
        reason: 'finish-reason-other',
        kind: 'anomaly',
      });
    });

    it('still retries "length" with substantive text (real truncation)', () => {
      const result = shouldRetryGeneration(
        'length',
        'A long but cut-off answ',
        [],
        FRESH,
      );
      expect(result).toEqual({
        retry: true,
        reason: 'finish-reason-length',
        kind: 'anomaly',
      });
    });
  });

  describe('step-cap continuation ("tool-calls")', () => {
    // Regression: chat turns capped by `stepCountIs(maxSteps)` end with
    // finishReason 'tool-calls' mid-work. That is an expected capacity stop —
    // it continues as kind 'step-cap' for up to MAX_STEP_CAP_CONTINUES
    // rounds, independent of the single anomaly-retry slot.
    it('continues a step-capped turn as kind step-cap', () => {
      const result = shouldRetryGeneration(
        'tool-calls',
        'Let me check...',
        [makeStep({ toolCalls: [{ toolName: 'search' }] })],
        FRESH,
      );
      expect(result).toEqual({
        retry: true,
        reason: 'step-cap-continue',
        kind: 'step-cap',
      });
    });

    it('keeps continuing while rounds remain', () => {
      const result = shouldRetryGeneration('tool-calls', '', [], {
        anomalyRetried: false,
        stepCapRounds: MAX_STEP_CAP_CONTINUES - 1,
      });
      expect(result).toEqual({
        retry: true,
        reason: 'step-cap-continue',
        kind: 'step-cap',
      });
    });

    it('stops once the continuation rounds are exhausted', () => {
      const result = shouldRetryGeneration('tool-calls', '', [], {
        anomalyRetried: false,
        stepCapRounds: MAX_STEP_CAP_CONTINUES,
      });
      expect(result).toEqual({
        retry: false,
        reason: 'step-cap-rounds-exhausted',
        kind: 'step-cap',
      });
    });

    it('continues a step-capped turn even after an anomaly retry was used', () => {
      const result = shouldRetryGeneration('tool-calls', '', [], {
        anomalyRetried: true,
        stepCapRounds: 0,
      });
      expect(result).toEqual({
        retry: true,
        reason: 'step-cap-continue',
        kind: 'step-cap',
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
      const result = shouldRetryGeneration('stop', '', steps, FRESH);
      expect(result).toEqual({
        retry: true,
        reason: 'stop-with-empty-tool-result',
        kind: 'anomaly',
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
        FRESH,
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
      const result = shouldRetryGeneration('tool-calls', '', steps, FRESH);
      expect(result).toEqual({ retry: false, reason: 'awaiting-human-input' });
    });

    it('does not retry on the "stop" + empty-text gate halt either', () => {
      const steps = [
        makeStep({
          toolCalls: [{ toolName: 'request_human_input' }],
          text: '',
        }),
      ];
      const result = shouldRetryGeneration('stop', '', steps, FRESH);
      expect(result).toEqual({ retry: false, reason: 'awaiting-human-input' });
    });

    it('still continues when request_human_input is only an EARLIER step', () => {
      // The model called the gate, then kept going on its own — that is NOT a
      // stopWhen halt, so the incomplete trailing tool call stays continuable.
      const steps = [
        makeStep({ toolCalls: [{ toolName: 'request_human_input' }] }),
        makeStep({ toolCalls: [{ toolName: 'web' }] }),
      ];
      const result = shouldRetryGeneration('tool-calls', '', steps, FRESH);
      expect(result).toEqual({
        retry: true,
        reason: 'step-cap-continue',
        kind: 'step-cap',
      });
    });

    it('still continues when the gate call failed input validation', () => {
      // Regression: a call the SDK marked `invalid: true` never executed, so
      // no approval card exists. Treating it as the gate halt suppressed the
      // retry and stranded the turn on a question the user could never see.
      const steps = [
        makeStep({
          toolCalls: [{ toolName: 'request_human_input', invalid: true }],
        }),
      ];
      const result = shouldRetryGeneration('tool-calls', '', steps, FRESH);
      expect(result).toEqual({
        retry: true,
        reason: 'step-cap-continue',
        kind: 'step-cap',
      });
    });
  });

  describe('already-retried guard (anomalies only)', () => {
    it('returns false when already retried, even for retryable finishReason', () => {
      const result = shouldRetryGeneration('length', 'Partial...', [], {
        anomalyRetried: true,
        stepCapRounds: 0,
      });
      expect(result).toEqual({ retry: false, reason: 'already-retried' });
    });

    it('returns false when already retried with undefined finishReason', () => {
      const result = shouldRetryGeneration(undefined, '', [], {
        anomalyRetried: true,
        stepCapRounds: 0,
      });
      expect(result).toEqual({ retry: false, reason: 'already-retried' });
    });

    it('returns false when already retried even for "stop" with empty tool result', () => {
      const steps = [makeStep({ toolCalls: [{ toolName: 'search' }] })];
      const result = shouldRetryGeneration('stop', '', steps, {
        anomalyRetried: true,
        stepCapRounds: 0,
      });
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

  it('returns false when the gate call failed input validation', () => {
    const steps = [
      makeStep({
        toolCalls: [{ toolName: 'request_human_input', invalid: true }],
      }),
    ];
    expect(endedOnHumanInputGate(steps)).toBe(false);
  });

  it('returns true when a valid gate call sits next to an invalid one', () => {
    const steps = [
      makeStep({
        toolCalls: [
          { toolName: 'request_human_input', invalid: true },
          { toolName: 'request_human_input' },
        ],
      }),
    ];
    expect(endedOnHumanInputGate(steps)).toBe(true);
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

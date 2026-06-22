import { describe, expect, it } from 'vitest';

import type { AgentEvent } from '../../../lib/agent-adapters/events';
import { errorTextFromEvent, looksLikeApiError } from './api_error_detection';

describe('looksLikeApiError', () => {
  it('matches the gateway stream-idle abort surfaced by the CLI', () => {
    expect(
      looksLikeApiError(
        'API Error: Error reading stream: stream idle timeout: no data received within configured window',
      ),
    ).toBe(true);
  });

  it('matches each indicator independently (case-insensitive)', () => {
    expect(looksLikeApiError('api error: overloaded')).toBe(true);
    expect(looksLikeApiError('Error reading stream')).toBe(true);
    expect(looksLikeApiError('upstream returned a STREAM IDLE TIMEOUT')).toBe(
      true,
    );
  });

  it('does not match benign text that merely mentions APIs or errors', () => {
    expect(looksLikeApiError('Let me check the API documentation.')).toBe(
      false,
    );
    expect(looksLikeApiError('the function returned an error code')).toBe(
      false,
    );
    expect(looksLikeApiError('reading the stream of events')).toBe(false);
  });
});

describe('errorTextFromEvent', () => {
  it('returns the text of a main-agent text / text-delta event', () => {
    expect(errorTextFromEvent({ type: 'text', text: 'API Error: boom' })).toBe(
      'API Error: boom',
    );
    expect(
      errorTextFromEvent({ type: 'text-delta', text: 'API Error: boom' }),
    ).toBe('API Error: boom');
  });

  it('ignores SUB-AGENT text (a sub-agent error is not the main turn dying)', () => {
    expect(
      errorTextFromEvent({
        type: 'text',
        text: 'API Error: boom',
        parentToolUseId: 'toolu_1',
      }),
    ).toBeUndefined();
  });

  it('EXCLUDES api_retry raw events — the SDK auto-retries those', () => {
    // Even though the payload literally contains the sentinel, an api_retry is a
    // recoverable pre-response retry and must NOT arm the stalled-turn watchdog.
    const apiRetry: AgentEvent = {
      type: 'raw',
      agent: 'claude-code',
      payload: {
        type: 'system',
        subtype: 'api_retry',
        message: 'API Error: overloaded, retrying',
      },
    };
    expect(errorTextFromEvent(apiRetry)).toBeUndefined();
  });

  it('scans other raw events (the error shape is not fixed)', () => {
    const rawErr: AgentEvent = {
      type: 'raw',
      agent: 'claude-code',
      payload: { type: 'system', subtype: 'error', message: 'API Error: 500' },
    };
    const text = errorTextFromEvent(rawErr);
    expect(text).toBeDefined();
    expect(looksLikeApiError(text ?? '')).toBe(true);
  });

  it('returns undefined for events that carry no surfaced error text', () => {
    expect(
      errorTextFromEvent({
        type: 'tool-use',
        toolUseId: 't1',
        toolName: 'Bash',
        input: {},
      }),
    ).toBeUndefined();
    expect(
      errorTextFromEvent({ type: 'result', status: 'completed' }),
    ).toBeUndefined();
  });
});

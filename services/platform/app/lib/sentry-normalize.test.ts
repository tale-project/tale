import { describe, expect, it } from 'vitest';

import {
  normalizeConvexSentryEvent,
  stripConvexRequestId,
} from './sentry-normalize';

// The exact client-visible shape convex composes (browser/logging.ts):
// `[CONVEX <kind>(<path>)] <server errorMessage>` where the server message
// starts with `[Request ID: …] Server Error`.
const RAW_ACTION_FAILURE =
  '[CONVEX A(agents/actions:listAgents)] [Request ID: 018f2a4b9c1d] Server Error\n' +
  'Uncaught ConvexError: {"code":"ORG_NOT_FOUND","message":"Organization \\"jh7csd7\\" not found."}\n' +
  '  Called by client';

describe('stripConvexRequestId', () => {
  it('removes the volatile request id but keeps function path and cause', () => {
    expect(stripConvexRequestId(RAW_ACTION_FAILURE)).toBe(
      '[CONVEX A(agents/actions:listAgents)] Server Error\n' +
        'Uncaught ConvexError: {"code":"ORG_NOT_FOUND","message":"Organization \\"jh7csd7\\" not found."}\n' +
        '  Called by client',
    );
  });

  it('collapses to identical text for two occurrences of the same failure', () => {
    const second = RAW_ACTION_FAILURE.replace('018f2a4b9c1d', 'ffee00112233');
    expect(stripConvexRequestId(RAW_ACTION_FAILURE)).toBe(
      stripConvexRequestId(second),
    );
  });

  it('handles a message that starts with the request id', () => {
    expect(
      stripConvexRequestId('[Request ID: abc123] Server Error\nUncaught …'),
    ).toBe('Server Error\nUncaught …');
  });

  it('leaves text without a request id untouched', () => {
    const plain = 'TypeError: x is not a function';
    expect(stripConvexRequestId(plain)).toBe(plain);
  });
});

describe('normalizeConvexSentryEvent', () => {
  it('normalizes message events (console-promoted failures)', () => {
    const event = normalizeConvexSentryEvent({ message: RAW_ACTION_FAILURE });
    expect(event.message).not.toContain('[Request ID:');
    expect(event.message).toContain('[CONVEX A(agents/actions:listAgents)]');
  });

  it('normalizes logentry messages', () => {
    const event = normalizeConvexSentryEvent({
      logentry: { message: RAW_ACTION_FAILURE },
    });
    expect(event.logentry?.message).not.toContain('[Request ID:');
  });

  it('normalizes every exception value', () => {
    const event = normalizeConvexSentryEvent({
      exception: {
        values: [
          { value: RAW_ACTION_FAILURE },
          { value: '[Request ID: 99] Server Error' },
        ],
      },
    });
    expect(event.exception?.values?.[0]?.value).not.toContain('[Request ID:');
    expect(event.exception?.values?.[1]?.value).toBe('Server Error');
  });

  it('passes unrelated events through unchanged', () => {
    const event = {
      message: 'plain failure',
      exception: { values: [{ value: 'TypeError: boom' }] },
    };
    expect(normalizeConvexSentryEvent(event)).toEqual({
      message: 'plain failure',
      exception: { values: [{ value: 'TypeError: boom' }] },
    });
  });
});

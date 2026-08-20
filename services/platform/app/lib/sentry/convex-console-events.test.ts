import type { ErrorEvent } from '@sentry/tanstackstart-react';
import { describe, expect, it } from 'vitest';

import {
  convexConsoleBeforeSend,
  normalizeConvexConsoleMessage,
} from './convex-console-events';

// #3020 regression: convex/react embeds a unique `[Request ID: …]` in every
// failure it logs, so two occurrences of the SAME failure never grouped —
// one GlitchTip issue per event. The beforeSend must make two such events
// carry one identity, keep the id findable, and drop only the console copies
// of outcomes the app already handles.

const LIST_AGENTS_A =
  '[CONVEX A(agents/actions:listAgents)] [Request ID: 5dabf348f1164725] Server Error';
const LIST_AGENTS_B =
  '[CONVEX A(agents/actions:listAgents)] [Request ID: 91c0aa10777d4e02] Server Error';

// `ErrorEvent` distinguishes itself from transactions by a required
// `type: undefined` — spell it out so these literals typecheck.
function consoleEvent(message: string): ErrorEvent {
  return { type: undefined, logger: 'console', message };
}

function exceptionEvent(value: string): ErrorEvent {
  return {
    type: undefined,
    exception: { values: [{ type: 'Error', value }] },
  };
}

describe('normalizeConvexConsoleMessage', () => {
  it('strips the request id and hands it back separately', () => {
    expect(normalizeConvexConsoleMessage(LIST_AGENTS_A)).toEqual({
      message: '[CONVEX A(agents/actions:listAgents)] Server Error',
      requestId: '5dabf348f1164725',
    });
  });

  it('leaves non-convex text alone', () => {
    expect(normalizeConvexConsoleMessage('ResizeObserver loop limit')).toBe(
      null,
    );
  });

  it('accepts a line without a request id', () => {
    expect(
      normalizeConvexConsoleMessage('[CONVEX Q(members/queries:list)] boom'),
    ).toEqual({
      message: '[CONVEX Q(members/queries:list)] boom',
      requestId: undefined,
    });
  });
});

describe('convexConsoleBeforeSend', () => {
  it('gives two occurrences of one failure the same identity', () => {
    const first = convexConsoleBeforeSend(consoleEvent(LIST_AGENTS_A));
    const second = convexConsoleBeforeSend(consoleEvent(LIST_AGENTS_B));

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;
    // Same fingerprint AND same message — grouped even where custom
    // fingerprints are not honoured.
    expect(first.fingerprint).toEqual(second.fingerprint);
    expect(first.message).toBe(second.message);
    expect(first.message).not.toContain('Request ID');
    // The per-call id stays findable as a tag.
    expect(first.tags).toEqual({ 'convex.request_id': '5dabf348f1164725' });
    expect(second.tags).toEqual({ 'convex.request_id': '91c0aa10777d4e02' });
  });

  it.each(['ORG_NOT_FOUND', 'ORG_FORBIDDEN', 'UNAUTHENTICATED'])(
    'drops the console copy of a client-handled %s failure',
    (code) => {
      const event = consoleEvent(
        `[CONVEX A(branding/file_actions:readBranding)] [Request ID: ab12] Server Error: Uncaught ConvexError: {"code":"${code}","message":"…"}`,
      );
      expect(convexConsoleBeforeSend(event)).toBeNull();
    },
  );

  it('keeps a boundary exception even for a handled code, but groups it', () => {
    const event = exceptionEvent(
      '[CONVEX Q(members/queries:getCurrentMemberContext)] [Request ID: cd34] Server Error: Uncaught ConvexError: {"code":"ORG_NOT_FOUND","message":"…"}',
    );
    const sent = convexConsoleBeforeSend(event);

    expect(sent).not.toBeNull();
    if (!sent) return;
    expect(sent.exception?.values?.[0]?.value).not.toContain('Request ID');
    expect(sent.fingerprint).toHaveLength(1);
    expect(sent.tags).toEqual({ 'convex.request_id': 'cd34' });
  });

  it('passes foreign events through untouched', () => {
    const message = consoleEvent('ResizeObserver loop limit exceeded');
    const exception = exceptionEvent('Cannot read properties of undefined');

    expect(convexConsoleBeforeSend(message)).toBe(message);
    expect(message.fingerprint).toBeUndefined();
    expect(message.message).toBe('ResizeObserver loop limit exceeded');

    expect(convexConsoleBeforeSend(exception)).toBe(exception);
    expect(exception.fingerprint).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import {
  isAbortErrorEvent,
  normalizeConvexSentryEvent,
  stripConvexRequestId,
} from './sentry-normalize';

// The exact client-visible shape convex composes (browser/logging.ts):
// `[CONVEX <kind>(<path>)] <server errorMessage>` where the server message
// starts with `[Request ID: …] Server Error`.
const RAW_ACTION_FAILURE =
  '[CONVEX A(agents/actions:listAgents)] [Request ID: 018f2a4b9c1d] Server Error\n' +
  'Uncaught AppError: {"code":"ORG_NOT_FOUND","message":"Organization \\"jh7csd7\\" not found."}\n' +
  '  Called by client';

describe('stripConvexRequestId', () => {
  it('removes the volatile request id but keeps function path and cause', () => {
    expect(stripConvexRequestId(RAW_ACTION_FAILURE)).toBe(
      '[CONVEX A(agents/actions:listAgents)] Server Error\n' +
        'Uncaught AppError: {"code":"ORG_NOT_FOUND","message":"Organization \\"jh7csd7\\" not found."}\n' +
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
  it('removes OAuth callback secrets from request and navigation metadata', () => {
    const event = normalizeConvexSentryEvent({
      request: {
        url: 'https://tale.example.test/oauth/consent?code=secret-code#secret-fragment',
        query_string: 'state=secret-state',
        data: { client_secret: 'secret-client' },
        cookies: { session: 'secret-cookie' },
        headers: {
          Authorization: 'Bearer secret-bearer',
          Cookie: 'session=secret-cookie',
          'X-Api-Key': 'secret-api-key',
          Referer: 'https://office.example.test/callback?code=secret-code',
          Accept: 'application/json',
        },
      },
      breadcrumbs: [
        {
          data: {
            from: '/log-in?redirectTo=secret-state',
            to: '/oauth/continue?sig=secret-signature',
            status_code: 200,
          },
        },
        {
          data: {
            url: 'https://tale.example.test/api/auth/oauth2/authorize?nonce=secret-nonce',
          },
        },
        {},
      ],
    });
    expect(JSON.stringify(event)).not.toContain('secret-');
    expect(event.request.url).toBe('https://tale.example.test/oauth/consent');
    expect(event.request.headers).toEqual({
      Referer: 'https://office.example.test/callback',
      Accept: 'application/json',
    });
    expect(event.breadcrumbs[0]?.data).toEqual({
      from: '/log-in',
      to: '/oauth/continue',
      status_code: 200,
    });
  });

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

describe('isAbortErrorEvent', () => {
  it('drops an event whose thrown value is a cancellation', () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      isAbortErrorEvent(
        { exception: { values: [{ type: 'Error', value: 'unrelated text' }] } },
        { originalException: controller.signal.reason },
      ),
    ).toBe(true);
  });

  it('drops the shape the SDK builds from a DOMException with a stack', () => {
    // GlitchTip: `AbortError: signal is aborted without reason`.
    expect(
      isAbortErrorEvent({
        exception: {
          values: [
            { type: 'AbortError', value: 'signal is aborted without reason' },
          ],
        },
      }),
    ).toBe(true);
  });

  it('drops the stringified shape of a stackless DOMException', () => {
    // GlitchTip: `Error: AbortError: The user aborted a request.` — Chromium
    // raises it without a stack when the abort lands mid-body.
    expect(
      isAbortErrorEvent({
        exception: {
          values: [
            { type: 'Error', value: 'AbortError: The user aborted a request.' },
          ],
        },
      }),
    ).toBe(true);
  });

  it('drops a console-promoted message that logged a cancellation', () => {
    // The error boundary's logger passes the error's fields as an object,
    // so the SDK records a message event with the fields as an argument.
    expect(
      isAbortErrorEvent({
        message: 'Error caught by boundary: [object Object]',
        extra: {
          arguments: [
            'Error caught by boundary:',
            { name: 'AbortError', message: 'signal is aborted without reason' },
          ],
        },
      }),
    ).toBe(true);
  });

  it('keeps a failure whose cause was a cancellation', () => {
    expect(
      isAbortErrorEvent(
        {
          exception: {
            values: [
              { type: 'AbortError', value: 'signal is aborted without reason' },
              { type: 'Error', value: 'Upload failed' },
            ],
          },
        },
        { originalException: new Error('Upload failed') },
      ),
    ).toBe(false);
  });

  it('keeps transport failures, timeouts and message events', () => {
    expect(
      isAbortErrorEvent(
        {
          exception: {
            values: [{ type: 'TypeError', value: 'Failed to fetch' }],
          },
        },
        { originalException: new TypeError('Failed to fetch') },
      ),
    ).toBe(false);
    expect(
      isAbortErrorEvent({
        exception: {
          values: [{ type: 'TimeoutError', value: 'signal timed out' }],
        },
      }),
    ).toBe(false);
    expect(isAbortErrorEvent({ message: 'AbortError' })).toBe(false);
    expect(
      isAbortErrorEvent({
        message: 'Failed to load releases: Error: boom',
        extra: { arguments: ['Failed to load releases:', new Error('boom')] },
      }),
    ).toBe(false);
  });
});

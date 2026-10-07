import { describe, expect, it } from 'vitest';

import { toBackendError } from '@/app/lib/backend/adapters';
import {
  BackendApiError,
  backendApiErrorFromBody,
} from '@/app/lib/backend/api-client';
import { AppError } from '@/lib/shared/errors/app-error';

import {
  isAbortErrorEvent,
  normalizeConvexSentryEvent,
  prepareSentryEvent,
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
    // A logged value that is no Error (here an object naming itself
    // `AbortError`) reaches the SDK only as an argument of a message event.
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

const APP_SCRIPT = 'https://tale.example.test/assets/index-4f2c1a.js';
// The extension behind #3094: it wraps `window.fetch`, so its frame is the
// innermost one of every failure it relays.
const EXTENSION_SCRIPT =
  'chrome-extension://hoklmmgfnpapgjgcpechhaamimifchmp/frame_ant/frame_ant.js';

/** One thrown error the way the browser SDK parses it: frames run from the
 *  outermost call to the innermost. */
function thrown(type: string, value: string, ...filenames: string[]) {
  return {
    exception: {
      values: [
        {
          type,
          value,
          stacktrace: { frames: filenames.map((filename) => ({ filename })) },
        },
      ],
    },
  };
}

const APP_BUG = "Cannot read properties of undefined (reading 'id')";

describe('prepareSentryEvent', () => {
  it('drops a cancelled request', () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      prepareSentryEvent(
        thrown('AbortError', 'signal is aborted without reason', APP_SCRIPT),
        { originalException: controller.signal.reason },
      ),
    ).toBeNull();
  });

  describe('browser extensions', () => {
    it.each([
      EXTENSION_SCRIPT,
      'moz-extension://2b6f0c1e-4d7a-4f8e-9c11-0a2b3c4d5e6f/content.js',
      'safari-web-extension://3284871F-A480-4FFC-8BC4-3F362C752446/content.js',
      'safari-extension://com.example.blocker-0000000000/script.js',
      'webkit-masked-url://hidden/',
    ])('drops an error whose innermost frame is %s', (url) => {
      expect(
        prepareSentryEvent(thrown('TypeError', APP_BUG, APP_SCRIPT, url)),
      ).toBeNull();
    });

    it('keeps our error when an extension only sits further out, e.g. around a timer callback', () => {
      expect(
        prepareSentryEvent(
          thrown('TypeError', APP_BUG, EXTENSION_SCRIPT, APP_SCRIPT),
        ),
      ).not.toBeNull();
    });

    it('looks past anonymous and native frames for the innermost script', () => {
      expect(
        prepareSentryEvent(
          thrown(
            'TypeError',
            APP_BUG,
            APP_SCRIPT,
            EXTENSION_SCRIPT,
            '[native code]',
            '<anonymous>',
          ),
        ),
      ).toBeNull();
    });

    it('judges the thrown error, not a linked cause', () => {
      // The SDK lists causes first, each marked by `parent_id`.
      const event = {
        exception: {
          values: [
            {
              type: 'TypeError',
              value: APP_BUG,
              mechanism: { type: 'chained', exception_id: 1, parent_id: 0 },
              stacktrace: { frames: [{ filename: EXTENSION_SCRIPT }] },
            },
            {
              type: 'Error',
              value: 'Saving the draft failed',
              mechanism: { type: 'generic', exception_id: 0 },
              stacktrace: { frames: [{ filename: APP_SCRIPT }] },
            },
          ],
        },
      };
      expect(prepareSentryEvent(event)).not.toBeNull();
    });
  });

  describe('expected refusals', () => {
    it('drops the AppError a 4xx becomes, which the mutation hooks log', () => {
      const refusal = toBackendError(
        new BackendApiError(403, 'Only owners can do this.', 'ROLE_FORBIDDEN'),
      );
      expect(refusal).toBeInstanceOf(AppError);
      expect(
        prepareSentryEvent(
          thrown('AppError', '{"code":"ROLE_FORBIDDEN"}', APP_SCRIPT),
          { originalException: refusal },
        ),
      ).toBeNull();
    });

    it('drops a BackendApiError under 500', () => {
      expect(
        prepareSentryEvent(thrown('BackendApiError', 'Not found', APP_SCRIPT), {
          originalException: new BackendApiError(404, 'Not found'),
        }),
      ).toBeNull();
    });

    it('keeps a 5xx, even one carrying structured data', () => {
      const fault = new BackendApiError(
        503,
        'Object store unavailable',
        'OBJECT_STORE_UNAVAILABLE',
        { retryAfterMs: 5000 },
      );
      // The adapter lane passes a 5xx through untouched.
      expect(toBackendError(fault)).toBe(fault);
      expect(
        prepareSentryEvent(
          thrown('BackendApiError', 'Object store unavailable', APP_SCRIPT),
          { originalException: fault },
        ),
      ).not.toBeNull();
    });

    it('keeps an app TypeError', () => {
      expect(
        prepareSentryEvent(thrown('TypeError', APP_BUG, APP_SCRIPT), {
          originalException: new TypeError(APP_BUG),
        }),
      ).not.toBeNull();
    });
  });

  describe('transport failures', () => {
    it.each([
      'Failed to fetch',
      'Failed to fetch (tale.example.test)',
      'Load failed',
      'Load failed (tale.example.test)',
      'NetworkError when attempting to fetch resource.',
      'NetworkError when attempting to fetch resource. (tale.example.test)',
    ])('drops TypeError: %s', (message) => {
      expect(
        prepareSentryEvent(thrown('TypeError', message, APP_SCRIPT), {
          originalException: new TypeError(message),
        }),
      ).toBeNull();
    });

    it('keeps a stale-bundle import failure and errors that only read like one', () => {
      expect(
        prepareSentryEvent(
          thrown(
            'TypeError',
            'Failed to fetch dynamically imported module: https://tale.example.test/assets/chat-9a1b.js',
            APP_SCRIPT,
          ),
        ),
      ).not.toBeNull();
      expect(
        prepareSentryEvent(
          thrown('TypeError', 'Avatar preview: Failed to fetch', APP_SCRIPT),
        ),
      ).not.toBeNull();
      expect(
        prepareSentryEvent(thrown('Error', 'Failed to fetch', APP_SCRIPT)),
      ).not.toBeNull();
    });
  });

  describe('an unavailable platform', () => {
    // What the mutation hooks and the error boundaries log while the platform
    // restarts — one event per failed request, from every open tab (GlitchTip
    // tale/tale #109).
    const EDGE =
      'The platform is not answering right now — a deployment may be rolling; retry with backoff';
    const DATABASE =
      'The platform’s database is not answering right now — it may be restarting; retry with backoff';

    it.each([502, 503, 504])(
      "drops the edge's UPSTREAM_UNAVAILABLE at %i",
      (status) => {
        expect(
          prepareSentryEvent(thrown('BackendApiError', EDGE, APP_SCRIPT), {
            originalException: backendApiErrorFromBody(status, {
              error: EDGE,
              code: 'UPSTREAM_UNAVAILABLE',
              requestId: 'edge-1',
            }),
          }),
        ).toBeNull();
      },
    );

    it("drops the platform's DATABASE_UNAVAILABLE", () => {
      expect(
        prepareSentryEvent(thrown('BackendApiError', DATABASE, APP_SCRIPT), {
          originalException: backendApiErrorFromBody(503, {
            error: DATABASE,
            code: 'DATABASE_UNAVAILABLE',
            requestId: 'req-1',
          }),
        }),
      ).toBeNull();
    });

    it.each([502, 503, 504])(
      'drops an unstructured gateway outage at %i',
      (status) => {
        expect(
          prepareSentryEvent(
            thrown(
              'BackendApiError',
              `Request failed with status ${status}`,
              APP_SCRIPT,
            ),
            { originalException: backendApiErrorFromBody(status, null) },
          ),
        ).toBeNull();
      },
    );

    it('keeps backend faults and an identified dependency refusal', () => {
      expect(
        prepareSentryEvent(
          thrown(
            'BackendApiError',
            'Request failed with status 500',
            APP_SCRIPT,
          ),
          { originalException: backendApiErrorFromBody(500, null) },
        ),
      ).not.toBeNull();
      expect(
        prepareSentryEvent(
          thrown(
            'BackendApiError',
            'Request failed with status 502',
            APP_SCRIPT,
          ),
          {
            originalException: backendApiErrorFromBody(502, {
              code: 'OBJECT_STORE_UNAVAILABLE',
              message: 'Object store unavailable',
            }),
          },
        ),
      ).not.toBeNull();
    });

    it('judges the thrown value, never the text an event carries', () => {
      expect(
        prepareSentryEvent(thrown('BackendApiError', EDGE, APP_SCRIPT)),
      ).not.toBeNull();
      expect(
        prepareSentryEvent({ message: `Mutation failed: ${EDGE}` }),
      ).not.toBeNull();
    });
  });

  it('normalizes the events it keeps', () => {
    const event = prepareSentryEvent({ message: RAW_ACTION_FAILURE });
    expect(event?.message).toBe(
      '[CONVEX A(agents/actions:listAgents)] Server Error\n' +
        'Uncaught AppError: {"code":"ORG_NOT_FOUND","message":"Organization \\"jh7csd7\\" not found."}\n' +
        '  Called by client',
    );
  });
});

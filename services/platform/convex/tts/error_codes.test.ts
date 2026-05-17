import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { SafeFetchError } from '../lib/http/safe_fetch';
import { NoProviderAvailableError } from '../providers/errors';
import {
  errorCodeFromCaught,
  parseRetryAfterMs,
  TtsProviderHttpError,
  ttsErrorCodeLiterals,
  type TtsErrorCode,
} from './error_codes';

describe('errorCodeFromCaught', () => {
  // Compact table over every distinct branch the classifier owns. Retry
  // policy is owned by the client (use-voice-output.ts `RETRYABLE_ERROR_CODES`)
  // so this table no longer pins a `retryable` flag — the classifier just
  // returns the code.
  const cases: Array<{
    name: string;
    err: unknown;
    expectedCode: TtsErrorCode;
  }> = [
    {
      name: 'NoProviderAvailableError instance',
      err: new NoProviderAvailableError('no providers', 'no_providers'),
      expectedCode: 'NO_PROVIDER',
    },
    {
      name: 'reserialized NoProviderAvailableError (substring match)',
      err: new Error('Uncaught NoProviderAvailableError: providers down'),
      expectedCode: 'NO_PROVIDER',
    },
    {
      name: 'ConvexError UNKNOWN_MODEL',
      err: new ConvexError({ code: 'UNKNOWN_MODEL', message: 'x' }),
      expectedCode: 'UNKNOWN_MODEL',
    },
    {
      name: 'ConvexError UNKNOWN_PROVIDER',
      err: new ConvexError({ code: 'UNKNOWN_PROVIDER', message: 'x' }),
      expectedCode: 'UNKNOWN_PROVIDER',
    },
    {
      name: 'ConvexError RATE_LIMITED',
      err: new ConvexError({ code: 'RATE_LIMITED', message: 'x' }),
      expectedCode: 'RATE_LIMITED',
    },
    {
      name: 'ConvexError BUDGET_EXCEEDED',
      err: new ConvexError({ code: 'BUDGET_EXCEEDED', message: 'x' }),
      expectedCode: 'BUDGET_EXCEEDED',
    },
    {
      name: 'ConvexError MESSAGE_CHAR_LIMIT',
      err: new ConvexError({ code: 'MESSAGE_CHAR_LIMIT', message: 'x' }),
      expectedCode: 'MESSAGE_CHAR_LIMIT',
    },
    {
      name: 'ConvexError INVALID_URL → HOST_POLICY',
      err: new ConvexError({ code: 'INVALID_URL', message: 'x' }),
      expectedCode: 'HOST_POLICY',
    },
    {
      name: 'ConvexError BLOCKED_HOST → HOST_POLICY',
      err: new ConvexError({ code: 'BLOCKED_HOST', message: 'x' }),
      expectedCode: 'HOST_POLICY',
    },
    {
      name: 'ConvexError PRIVATE_HOST_BLOCKED → HOST_POLICY',
      err: new ConvexError({ code: 'PRIVATE_HOST_BLOCKED', message: 'x' }),
      expectedCode: 'HOST_POLICY',
    },
    {
      name: 'SafeFetchError invalid_url → HOST_POLICY',
      err: new SafeFetchError('invalid_url', 'bad url'),
      expectedCode: 'HOST_POLICY',
    },
    {
      name: 'SafeFetchError unsupported_protocol → HOST_POLICY',
      err: new SafeFetchError('unsupported_protocol', 'ftp'),
      expectedCode: 'HOST_POLICY',
    },
    {
      name: 'SafeFetchError insecure_public_http → HOST_POLICY',
      err: new SafeFetchError('insecure_public_http', 'http to public host'),
      expectedCode: 'HOST_POLICY',
    },
    {
      name: 'SafeFetchError private_ip → HOST_POLICY',
      err: new SafeFetchError('private_ip', '169.254.x.x'),
      expectedCode: 'HOST_POLICY',
    },
    {
      name: 'SafeFetchError redirect_missing_location → HOST_POLICY',
      err: new SafeFetchError('redirect_missing_location', 'no Location'),
      expectedCode: 'HOST_POLICY',
    },
    {
      name: 'SafeFetchError redirect_limit_exceeded → HOST_POLICY',
      err: new SafeFetchError('redirect_limit_exceeded', 'too many'),
      expectedCode: 'HOST_POLICY',
    },
    {
      name: 'SafeFetchError response_too_large → PROVIDER_INVALID_RESPONSE',
      err: new SafeFetchError('response_too_large', '> 5 MB'),
      expectedCode: 'PROVIDER_INVALID_RESPONSE',
    },
    {
      name: 'SafeFetchError response_too_small → PROVIDER_INVALID_RESPONSE',
      err: new SafeFetchError('response_too_small', 'empty body'),
      expectedCode: 'PROVIDER_INVALID_RESPONSE',
    },
    {
      name: 'SafeFetchError timeout → TIMEOUT',
      err: new SafeFetchError('timeout', 'aborted'),
      expectedCode: 'TIMEOUT',
    },
    {
      name: 'SafeFetchError network_error → PROVIDER_ERROR',
      err: new SafeFetchError('network_error', 'ECONNRESET'),
      expectedCode: 'PROVIDER_ERROR',
    },
    {
      name: 'UNKNOWN_VOICE prefix Error',
      err: new Error('UNKNOWN_VOICE: nova not in catalogue'),
      expectedCode: 'UNKNOWN_VOICE',
    },
    {
      name: 'AbortError → TIMEOUT',
      err: Object.assign(new Error('aborted'), { name: 'AbortError' }),
      expectedCode: 'TIMEOUT',
    },
    {
      name: 'TTS API 429 (legacy Error shape) → RATE_LIMITED',
      err: new Error('TTS API 429: rate limited'),
      expectedCode: 'RATE_LIMITED',
    },
    {
      name: 'TtsProviderHttpError 429 → RATE_LIMITED',
      err: new TtsProviderHttpError(429, undefined, 'rate limited'),
      expectedCode: 'RATE_LIMITED',
    },
    {
      name: 'TtsProviderHttpError 401 → PROVIDER_AUTH (was lumped into 4XX)',
      err: new TtsProviderHttpError(401, undefined, 'unauthorized'),
      expectedCode: 'PROVIDER_AUTH',
    },
    {
      name: 'TtsProviderHttpError 403 → PROVIDER_AUTH',
      err: new TtsProviderHttpError(403, undefined, 'forbidden'),
      expectedCode: 'PROVIDER_AUTH',
    },
    {
      name: 'TtsProviderHttpError 400 → PROVIDER_BAD_REQUEST',
      err: new TtsProviderHttpError(400, undefined, 'bad request'),
      expectedCode: 'PROVIDER_BAD_REQUEST',
    },
    {
      name: 'TtsProviderHttpError 422 → PROVIDER_BAD_REQUEST',
      err: new TtsProviderHttpError(422, undefined, 'unprocessable'),
      expectedCode: 'PROVIDER_BAD_REQUEST',
    },
    {
      name: 'TtsProviderHttpError 413 → PROVIDER_PAYLOAD_TOO_LARGE',
      err: new TtsProviderHttpError(413, undefined, 'payload too large'),
      expectedCode: 'PROVIDER_PAYLOAD_TOO_LARGE',
    },
    {
      name: 'TtsProviderHttpError 418 → PROVIDER_4XX (generic fallback)',
      err: new TtsProviderHttpError(418, undefined, 'teapot'),
      expectedCode: 'PROVIDER_4XX',
    },
    {
      name: 'TTS API 500 → PROVIDER_5XX',
      err: new Error('TTS API 500: internal'),
      expectedCode: 'PROVIDER_5XX',
    },
    {
      name: 'TTS API 502 → PROVIDER_5XX',
      err: new Error('TTS API 502: bad gateway'),
      expectedCode: 'PROVIDER_5XX',
    },
    {
      name: 'TtsProviderHttpError 503 → PROVIDER_5XX',
      err: new TtsProviderHttpError(503, undefined, 'unavailable'),
      expectedCode: 'PROVIDER_5XX',
    },
    {
      name: 'unmatched generic Error → PROVIDER_ERROR',
      err: new Error('something else'),
      expectedCode: 'PROVIDER_ERROR',
    },
    {
      name: 'unmatched non-Error (string) → PROVIDER_ERROR',
      err: 'plain string error',
      expectedCode: 'PROVIDER_ERROR',
    },
  ];

  for (const { name, err, expectedCode } of cases) {
    it(name, () => {
      const result = errorCodeFromCaught(err);
      expect(result.code).toBe(expectedCode);
    });
  }

  // Defends against silent drift: a new literal added to
  // `ttsErrorCodeLiterals` without a corresponding classification path
  // (or test row) will fail this guard. Some codes are never produced by
  // `errorCodeFromCaught` itself (e.g. `CONTENTION` is raised inline in
  // `synthesize.ts` when the rate-limiter OCC retries exhaust); those
  // are listed here so the guard documents who owns them.
  const PRODUCED_BY_CALLERS_NOT_CLASSIFIER: ReadonlySet<TtsErrorCode> = new Set(
    [
      // Raised inline in `synthesize.ts` when the rate-limiter OCC retries
      // exhaust under burst contention; never produced by the classifier.
      'CONTENTION',
      // Raised by `reserveChunk` (mutations.ts) as a `ConvexError`; the
      // action intentionally lets it propagate to the client without
      // catching it, so the classifier branch is defensive-only.
      'MESSAGE_CHAR_LIMIT',
      // Scheduled by `reserveChunk`'s watchdog via `markChunkFailed`; the
      // mutation patches this code directly onto the chunk row when the
      // scheduled delete fires, so the classifier never sees it.
      'WATCHDOG_TIMEOUT',
    ],
  );

  it('every TtsErrorCode literal has either a classifier branch or a documented owner', () => {
    const seen = new Set<TtsErrorCode>(cases.map((c) => c.expectedCode));
    for (const code of ttsErrorCodeLiterals) {
      if (PRODUCED_BY_CALLERS_NOT_CLASSIFIER.has(code)) continue;
      expect(seen.has(code), `no classifier case produces ${code}`).toBe(true);
    }
  });

  it('threads Retry-After from TtsProviderHttpError onto RATE_LIMITED result', () => {
    const result = errorCodeFromCaught(
      new TtsProviderHttpError(429, 7_500, 'rate limited'),
    );
    expect(result.code).toBe('RATE_LIMITED');
    expect(result.retryAfterMs).toBe(7_500);
  });

  it('threads retryAfter (seconds) from ConvexError onto RATE_LIMITED result', () => {
    const result = errorCodeFromCaught(
      new ConvexError({
        code: 'RATE_LIMITED',
        message: 'rate limited',
        retryAfter: 3,
      }),
    );
    expect(result.code).toBe('RATE_LIMITED');
    expect(result.retryAfterMs).toBe(3_000);
  });
});

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds form', () => {
    expect(parseRetryAfterMs('5')).toBe(5_000);
    expect(parseRetryAfterMs('  0  ')).toBe(0);
  });

  it('parses HTTP-date form', () => {
    const future = new Date(Date.now() + 10_000);
    const result = parseRetryAfterMs(future.toUTCString());
    // Allow a tolerance window for parse-time drift.
    expect(result).toBeGreaterThan(8_000);
    expect(result).toBeLessThanOrEqual(10_000);
  });

  it('returns undefined for past dates, malformed input, and null/undefined', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs('')).toBeUndefined();
    expect(parseRetryAfterMs('not-a-date')).toBeUndefined();
    const past = new Date(Date.now() - 10_000);
    expect(parseRetryAfterMs(past.toUTCString())).toBeUndefined();
    expect(parseRetryAfterMs('-1')).toBeUndefined();
  });
});

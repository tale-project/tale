import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { SafeFetchError } from '../../lib/http/safe_fetch';
import { NoProviderAvailableError } from '../../providers/errors';
import { errorCodeFromCaught, type TtsErrorCode } from '../error_codes';

describe('errorCodeFromCaught', () => {
  // Compact table over every distinct branch the classifier owns. Each row
  // pins the expected (`code`, `retryable`) pair so a future refactor that
  // accidentally collapses a branch is caught.
  const cases: Array<{
    name: string;
    err: unknown;
    expectedCode: TtsErrorCode;
    retryable: boolean;
  }> = [
    {
      name: 'NoProviderAvailableError instance',
      err: new NoProviderAvailableError('no providers', 'no_providers'),
      expectedCode: 'NO_PROVIDER',
      retryable: false,
    },
    {
      name: 'reserialized NoProviderAvailableError (substring match)',
      err: new Error('Uncaught NoProviderAvailableError: providers down'),
      expectedCode: 'NO_PROVIDER',
      retryable: false,
    },
    {
      name: 'ConvexError UNKNOWN_MODEL',
      err: new ConvexError({ code: 'UNKNOWN_MODEL', message: 'x' }),
      expectedCode: 'UNKNOWN_MODEL',
      retryable: false,
    },
    {
      name: 'ConvexError UNKNOWN_PROVIDER',
      err: new ConvexError({ code: 'UNKNOWN_PROVIDER', message: 'x' }),
      expectedCode: 'UNKNOWN_PROVIDER',
      retryable: false,
    },
    {
      name: 'ConvexError RATE_LIMITED (retryable)',
      err: new ConvexError({ code: 'RATE_LIMITED', message: 'x' }),
      expectedCode: 'RATE_LIMITED',
      retryable: true,
    },
    {
      name: 'ConvexError BUDGET_EXCEEDED (terminal)',
      err: new ConvexError({ code: 'BUDGET_EXCEEDED', message: 'x' }),
      expectedCode: 'BUDGET_EXCEEDED',
      retryable: false,
    },
    {
      name: 'ConvexError MESSAGE_CHAR_LIMIT',
      err: new ConvexError({ code: 'MESSAGE_CHAR_LIMIT', message: 'x' }),
      expectedCode: 'MESSAGE_CHAR_LIMIT',
      retryable: false,
    },
    {
      name: 'ConvexError INVALID_URL → HOST_POLICY',
      err: new ConvexError({ code: 'INVALID_URL', message: 'x' }),
      expectedCode: 'HOST_POLICY',
      retryable: false,
    },
    {
      name: 'ConvexError BLOCKED_HOST → HOST_POLICY',
      err: new ConvexError({ code: 'BLOCKED_HOST', message: 'x' }),
      expectedCode: 'HOST_POLICY',
      retryable: false,
    },
    {
      name: 'ConvexError PRIVATE_HOST_BLOCKED → HOST_POLICY',
      err: new ConvexError({ code: 'PRIVATE_HOST_BLOCKED', message: 'x' }),
      expectedCode: 'HOST_POLICY',
      retryable: false,
    },
    {
      name: 'SafeFetchError invalid_url → HOST_POLICY',
      err: new SafeFetchError('invalid_url', 'bad url'),
      expectedCode: 'HOST_POLICY',
      retryable: false,
    },
    {
      name: 'SafeFetchError unsupported_protocol → HOST_POLICY',
      err: new SafeFetchError('unsupported_protocol', 'ftp'),
      expectedCode: 'HOST_POLICY',
      retryable: false,
    },
    {
      name: 'SafeFetchError private_ip → HOST_POLICY',
      err: new SafeFetchError('private_ip', '169.254.x.x'),
      expectedCode: 'HOST_POLICY',
      retryable: false,
    },
    {
      name: 'SafeFetchError redirect_missing_location → HOST_POLICY',
      err: new SafeFetchError('redirect_missing_location', 'no Location'),
      expectedCode: 'HOST_POLICY',
      retryable: false,
    },
    {
      name: 'SafeFetchError redirect_limit_exceeded → HOST_POLICY',
      err: new SafeFetchError('redirect_limit_exceeded', 'too many'),
      expectedCode: 'HOST_POLICY',
      retryable: false,
    },
    {
      name: 'SafeFetchError response_too_large → PROVIDER_4XX',
      err: new SafeFetchError('response_too_large', '> 5 MB'),
      expectedCode: 'PROVIDER_4XX',
      retryable: false,
    },
    {
      name: 'SafeFetchError timeout → TIMEOUT (retryable)',
      err: new SafeFetchError('timeout', 'aborted'),
      expectedCode: 'TIMEOUT',
      retryable: true,
    },
    {
      name: 'SafeFetchError network_error → PROVIDER_ERROR',
      err: new SafeFetchError('network_error', 'ECONNRESET'),
      expectedCode: 'PROVIDER_ERROR',
      retryable: false,
    },
    {
      name: 'UNKNOWN_VOICE prefix Error',
      err: new Error('UNKNOWN_VOICE: nova not in catalogue'),
      expectedCode: 'UNKNOWN_VOICE',
      retryable: false,
    },
    {
      name: 'AbortError → TIMEOUT (retryable)',
      err: Object.assign(new Error('aborted'), { name: 'AbortError' }),
      expectedCode: 'TIMEOUT',
      retryable: true,
    },
    {
      name: 'TTS API 429 → RATE_LIMITED (retryable)',
      err: new Error('TTS API 429: rate limited'),
      expectedCode: 'RATE_LIMITED',
      retryable: true,
    },
    {
      name: 'TTS API 401 → PROVIDER_4XX (terminal, bad key)',
      err: new Error('TTS API 401: unauthorized'),
      expectedCode: 'PROVIDER_4XX',
      retryable: false,
    },
    {
      name: 'TTS API 500 → PROVIDER_5XX (retryable)',
      err: new Error('TTS API 500: internal'),
      expectedCode: 'PROVIDER_5XX',
      retryable: true,
    },
    {
      name: 'TTS API 502 → PROVIDER_5XX (retryable)',
      err: new Error('TTS API 502: bad gateway'),
      expectedCode: 'PROVIDER_5XX',
      retryable: true,
    },
    {
      name: 'unmatched generic Error → PROVIDER_ERROR',
      err: new Error('something else'),
      expectedCode: 'PROVIDER_ERROR',
      retryable: false,
    },
    {
      name: 'unmatched non-Error (string) → PROVIDER_ERROR',
      err: 'plain string error',
      expectedCode: 'PROVIDER_ERROR',
      retryable: false,
    },
  ];

  for (const { name, err, expectedCode, retryable } of cases) {
    it(name, () => {
      const result = errorCodeFromCaught(err);
      expect(result.code).toBe(expectedCode);
      expect(result.retryable).toBe(retryable);
      expect(typeof result.detail).toBe('string');
    });
  }
});

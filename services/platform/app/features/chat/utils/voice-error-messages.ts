/**
 * Shared mapping from TTS error codes → i18n message keys. Used by both
 * the voice output indicator (visible reason chip + tooltip) and the
 * announcer (aria-live SR readout) so a code added in one place can't
 * silently fall through to the generic fallback in the other.
 *
 * Pure module — imports no React, no contexts — so either consumer can
 * pull it without dragging the other's render path.
 *
 * Code coverage:
 *  - Server-classified codes from `convex/tts/error_codes.ts`
 *    (NO_PROVIDER, UNKNOWN_*, RATE_LIMITED, BUDGET_EXCEEDED, TIMEOUT,
 *    PROVIDER_*, PROVIDER_INVALID_RESPONSE, HOST_POLICY,
 *    MESSAGE_CHAR_LIMIT, CONTENTION, WATCHDOG_TIMEOUT,
 *    PROVIDER_AUTH/BAD_REQUEST/PAYLOAD_TOO_LARGE).
 *  - ConvexError data codes raised by reservation/auth checks
 *    (forbidden, TTS_CHUNK_LIMIT, TTS_TEXT_TOO_LONG, TTS_EMPTY_TEXT,
 *    MESSAGE_CHAR_LIMIT).
 *  - Client-side synthetic codes (UNKNOWN_NETWORK, QUEUE_OVERFLOW,
 *    AUDIO_DECODE, AUDIO_FETCH_AUTH).
 */
export function voiceErrorMessageKey(
  code: string | undefined,
  /**
   * Key returned for codes that don't match any specific branch
   * (including `PROVIDER_4XX`, `PROVIDER_ERROR`, and unknown codes).
   * The indicator uses `voice.voiceOutputError`; the announcer uses
   * `voice.voiceOutputAnnounceError` (the SR copy is phrased
   * differently because hover/click affordances aren't reachable).
   */
  fallbackKey: string = 'voice.voiceOutputError',
): string {
  switch (code) {
    case 'NO_PROVIDER':
    case 'UNKNOWN_PROVIDER':
    case 'UNKNOWN_MODEL':
    case 'UNKNOWN_VOICE':
      return 'voice.voiceOutputErrorConfig';
    case 'RATE_LIMITED':
      return 'voice.voiceOutputErrorRateLimited';
    case 'BUDGET_EXCEEDED':
      return 'voice.voiceOutputErrorBudget';
    case 'TIMEOUT':
    case 'PROVIDER_5XX':
    // CONTENTION is rate-limiter shard OCC, not quota — the chunker is
    // already retrying internally with short jitter. Surface as
    // transient so the user knows it's not stuck.
    case 'CONTENTION':
    // WATCHDOG_TIMEOUT means the server-side scheduler flipped a
    // stuck-pending row to failed. Same UX as TIMEOUT — retryable.
    case 'WATCHDOG_TIMEOUT':
      return 'voice.voiceOutputErrorTransient';
    // Client-side fallback raised when an action throw isn't a typed
    // ConvexError — surface as a network problem so the user has an
    // actionable read instead of staring at a stuck spinner.
    case 'UNKNOWN_NETWORK':
      return 'voice.voiceOutputErrorNetwork';
    // Client-side cap raised by the chunker when the synthesis queue
    // is full — playback paused so the user isn't surprised by silent
    // tail of message.
    case 'QUEUE_OVERFLOW':
      return 'voice.voiceOutputErrorQueueOverflow';
    // Synthetic client-side code raised by use-voice-output-player when
    // every server-ready chunk's `<audio>` element decode/fetch failed —
    // distinct from the server-classified codes above.
    case 'AUDIO_DECODE':
      return 'voice.voiceOutputErrorDecode';
    // Synthetic client-side code raised when the pre-flight HEAD probe
    // on the same-origin /api/tts-audio endpoint returns 401 (session
    // cookie expired / revoked). Distinct from AUDIO_DECODE so the UX
    // can tell the user to sign in again, not "audio failed to decode".
    case 'AUDIO_FETCH_AUTH':
      return 'voice.voiceOutputErrorAuthExpired';
    // Server returned a 2xx response with an unusable body (stream cap
    // tripped, or pre-store size check refused near-empty audio). UX is
    // "voice provider returned invalid audio" — retryable, transient.
    case 'PROVIDER_INVALID_RESPONSE':
      return 'voice.voiceOutputErrorInvalidResponse';
    case 'MESSAGE_CHAR_LIMIT':
      return 'voice.voiceOutputErrorMessageCharLimit';
    // `HOST_POLICY` (provider URL blocked by SSRF guard / private-IP
    // allowlist) and `forbidden` (membership / IDOR refusal) both mean
    // "the server refused to call out at all". Same recovery: ask an
    // admin to check provider config / network policy.
    case 'HOST_POLICY':
    case 'forbidden':
      return 'voice.voiceOutputErrorForbidden';
    case 'TTS_CHUNK_LIMIT':
    case 'TTS_TEXT_TOO_LONG':
    case 'TTS_EMPTY_TEXT':
      return 'voice.voiceOutputErrorChunkLimit';
    // 401/403: bad API key — config issue (admin-actionable).
    case 'PROVIDER_AUTH':
      return 'voice.voiceOutputErrorConfig';
    // 413: payload too large — caller could resegment, but for the user
    // there's no immediate action. Surface as generic error.
    case 'PROVIDER_PAYLOAD_TOO_LARGE':
    // 400/422: bad request shape — code bug, generic error.
    case 'PROVIDER_BAD_REQUEST':
    case 'PROVIDER_4XX':
    case 'PROVIDER_ERROR':
    default:
      return fallbackKey;
  }
}

/**
 * Resolve a TTS error code to a localized message. Thin wrapper around
 * `voiceErrorMessageKey` + a passed `t` translator so consumers don't
 * have to look up the key themselves.
 */
export function errorMessageForCode(
  code: string | undefined,
  t: (key: string) => string,
  fallbackKey?: string,
): string {
  return t(voiceErrorMessageKey(code, fallbackKey));
}

/**
 * Retry classification for the file-upload transcription pipeline.
 * Kept next to the HTTP error helpers rather than resurrecting the retired
 * chat-wide `error_classification` module — this surface only needs the
 * status / message rules Whisper and OpenRouter actually return.
 */

export interface TranscriptionErrorClassification {
  readonly shouldRetry: boolean;
  readonly reason: string;
}

export function classifyTranscriptionError(
  error: unknown,
): TranscriptionErrorClassification {
  const isObject = (val: unknown): val is Record<string, unknown> =>
    val !== null && typeof val === 'object';

  const err = isObject(error) ? error : {};
  const data = isObject(err.data) ? err.data : undefined;
  const message = (
    typeof err.message === 'string' ? err.message : ''
  ).toLowerCase();
  const status =
    typeof err.status === 'number'
      ? err.status
      : typeof err.statusCode === 'number'
        ? err.statusCode
        : undefined;
  const code =
    typeof err.code === 'string'
      ? err.code
      : typeof data?.code === 'string'
        ? data.code
        : undefined;

  // No transcription model configured — permanent until an admin adds one.
  if (code === 'NO_TRANSCRIPTION_MODEL') {
    return { shouldRetry: false, reason: 'no_transcription_model' };
  }

  if (status === 401 || status === 403) {
    return { shouldRetry: false, reason: 'auth_error' };
  }
  if (status === 400) {
    return { shouldRetry: false, reason: 'bad_request' };
  }
  if (status === 404) {
    return { shouldRetry: false, reason: 'not_found' };
  }
  if (
    status === 402 ||
    message.includes('more credits') ||
    message.includes('can only afford') ||
    (message.includes('credit') && message.includes('insufficient'))
  ) {
    return { shouldRetry: false, reason: 'credit_exhausted' };
  }

  if (status === 429 || message.includes('rate limit')) {
    return { shouldRetry: true, reason: 'rate_limit' };
  }
  if (status !== undefined && status >= 500 && status < 600) {
    return { shouldRetry: true, reason: 'server_error' };
  }
  if (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    message.includes('network') ||
    message.includes('connection') ||
    message.includes('socket') ||
    message.includes('fetch failed')
  ) {
    return { shouldRetry: true, reason: 'network_error' };
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return { shouldRetry: true, reason: 'timeout' };
  }
  if (message.includes('overloaded') || message.includes('capacity')) {
    return { shouldRetry: true, reason: 'overloaded' };
  }

  // Conservative default: retry unknown failures a few times.
  return { shouldRetry: true, reason: 'unknown' };
}

'use node';

/**
 * Shared transcription HTTP layer used by both the file-upload pipeline
 * (`transcribe_audio.ts`) and the one-shot dictation door
 * (`domains/files/transcription.ts`). Centralizing the request here keeps
 * the `/audio/transcriptions` wire in exactly one place so the callers
 * can't drift.
 */

export interface TranscriptionSegment {
  id?: number;
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionApiResult {
  text: string;
  /** Audio duration in seconds; a server that omits it leaves callers on
   * the locally-measured duration. */
  duration?: number;
  /** Timestamped segments; a server that omits them degrades timestamped
   * transcripts to plain text. */
  segments?: TranscriptionSegment[];
}

export interface TranscriptionRequestModel {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

/**
 * POST one audio blob to `{baseUrl}/audio/transcriptions` as
 * `multipart/form-data` with a binary `file` field and
 * `response_format: verbose_json` — the OpenAI Whisper wire that vLLM,
 * LocalAI and faster-whisper-server also speak — and return the parsed
 * transcript `{ text, duration, segments }`.
 *
 * Throws `Error & { status?: number }` on a non-2xx response so callers can
 * classify retryable (429/5xx) vs permanent (4xx) failures via `classifyError`.
 */
export async function requestTranscription(opts: {
  model: TranscriptionRequestModel;
  blob: Blob;
  /** File name for the `file` field. Whisper validates by extension, so
   * the caller must pass an accepted one (e.g. `clip.ogg`). */
  fileName: string;
  timeoutMs: number;
}): Promise<TranscriptionApiResult> {
  const { model, blob, fileName, timeoutMs } = opts;
  const url = `${model.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const formData = new FormData();
    formData.append('file', blob, fileName);
    formData.append('model', model.modelId);
    // `verbose_json` is required to get `duration` across OpenAI, vLLM,
    // LocalAI, and faster-whisper-server. Plain `json` omits it on OpenAI.
    formData.append('response_format', 'verbose_json');
    const init: RequestInit = {
      method: 'POST',
      headers: { Authorization: `Bearer ${model.apiKey}` },
      body: formData,
      signal: controller.signal,
    };

    const response = await fetch(url, init);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      // Attach the HTTP status so `classifyError` can mark 4xx as
      // non-retryable (vs. 429/5xx which should retry). Without this, all API
      // errors fall into the default `unknown + retryable` bucket.
      const err: Error & { status?: number } = new Error(
        `Transcription API ${response.status}: ${errorText.slice(0, 400)}`,
      );
      err.status = response.status;
      throw err;
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- OpenAI-compatible response shape
    const result = (await response.json()) as TranscriptionApiResult;
    return {
      // Some servers omit `text` on empty audio — normalize to '' so callers
      // (and Convex `v.string()` validators) never see `undefined`.
      text: typeof result.text === 'string' ? result.text : '',
      duration:
        typeof result.duration === 'number' ? result.duration : undefined,
      segments: Array.isArray(result.segments) ? result.segments : undefined,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

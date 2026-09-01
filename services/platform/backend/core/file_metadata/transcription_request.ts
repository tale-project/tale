'use node';

/**
 * Shared transcription HTTP layer used by both the file-upload pipeline
 * (`transcribe_audio.ts`) and the one-shot dictation action
 * (`transcribe_dictation.ts`). Centralizing the request here keeps the two
 * audio-transcription request conventions (see `transcriptionMode` in
 * `lib/shared/schemas/providers.ts`) in exactly one place so the callers can't
 * drift.
 */

export interface TranscriptionSegment {
  id?: number;
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionApiResult {
  text: string;
  /** Audio duration in seconds. Only the `multipart`/`verbose_json` path
   * returns this; `json-base64` omits it and callers fall back to the
   * locally-measured duration. */
  duration?: number;
  /** Timestamped segments. Only the `multipart`/`verbose_json` path returns
   * these; absent on `json-base64`, so timestamped transcripts degrade to
   * plain text. */
  segments?: TranscriptionSegment[];
}

export interface TranscriptionRequestModel {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  /** Request convention; absent ⇒ `multipart` (OpenAI Whisper-compatible). */
  transcriptionMode?: 'multipart' | 'json-base64';
}

/**
 * POST one audio blob to `{baseUrl}/audio/transcriptions` using the model's
 * configured request convention and return the parsed transcript.
 *
 *  - `multipart` (default): `multipart/form-data` with a binary `file` field
 *    and `response_format: verbose_json` — OpenAI Whisper, vLLM, LocalAI,
 *    faster-whisper-server. Returns `{ text, duration, segments }`.
 *  - `json-base64`: a JSON body with `input_audio: { data: <base64>, format }`
 *    — OpenRouter. Returns `{ text }` (+ optional `usage`); `duration` and
 *    `segments` are absent.
 *
 * Throws `Error & { status?: number }` on a non-2xx response so callers can
 * classify retryable (429/5xx) vs permanent (4xx) failures via `classifyError`.
 */
export async function requestTranscription(opts: {
  model: TranscriptionRequestModel;
  blob: Blob;
  /** File name for the `multipart` `file` field. Whisper validates by
   * extension, so the caller must pass an accepted one (e.g. `clip.ogg`). */
  fileName: string;
  /** Container/format string for the `json-base64` `input_audio.format` field
   * (e.g. `'ogg'`, `'webm'`, `'wav'`). Ignored by the `multipart` path. */
  format: string;
  timeoutMs: number;
}): Promise<TranscriptionApiResult> {
  const { model, blob, fileName, format, timeoutMs } = opts;
  const url = `${model.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let init: RequestInit;
    if (model.transcriptionMode === 'json-base64') {
      const data = Buffer.from(await blob.arrayBuffer()).toString('base64');
      init = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${model.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model.modelId,
          input_audio: { data, format },
        }),
        signal: controller.signal,
      };
    } else {
      const formData = new FormData();
      formData.append('file', blob, fileName);
      formData.append('model', model.modelId);
      // `verbose_json` is required to get `duration` across OpenAI, vLLM,
      // LocalAI, and faster-whisper-server. Plain `json` omits it on OpenAI.
      formData.append('response_format', 'verbose_json');
      init = {
        method: 'POST',
        headers: { Authorization: `Bearer ${model.apiKey}` },
        body: formData,
        signal: controller.signal,
      };
    }

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

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- OpenAI/OpenRouter-compatible response shape
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

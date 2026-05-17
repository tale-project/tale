/**
 * Shared TTS bounds — imported by both the client chunker
 * (`use-voice-output.ts`) and the server action (`tts/synthesize.ts`) so the
 * two cannot drift. Drift here caused round-2 file 13 finding 8 (`MAX_CHUNK_CHARS`
 * was 1800 client-side, 2000 server-side) — a config bug masked by the server
 * being more permissive than the client, which only surfaced when an
 * alternate client emitted a 1900-char chunk and the cap silently shifted.
 *
 * The character cap is a proxy for a true dollar cap. At OpenAI tts-1 pricing
 * (~$15/M chars), the per-message limit (`MAX_TTS_CHARS_PER_MESSAGE`) bounds
 * a single assistant reply to ~$0.75. The full structural fix is the
 * "two-component pricing model" deferred to a follow-up; this constant keeps
 * the worst-case bounded at demo stage.
 */

/** Maximum characters in a single TTS synthesis request to the provider. */
export const MAX_TTS_CHUNK_CHARS = 1800;

/**
 * Maximum total characters across all chunks of one assistant message.
 * Enforced in `reserveChunk` by aggregating `text.length` across existing
 * rows for `messageId` via the `by_message` index. A 50k cap bounds a
 * single reply to ~$0.75 at tts-1 rates / ~$5 at gpt-4o-mini-tts rates —
 * one or two pathologically long replies cannot run an operator's bill
 * past three digits before the cap trips.
 */
export const MAX_TTS_CHARS_PER_MESSAGE = 50_000;

/**
 * Hard cap on chunk count per assistant message. Bounds index-walking
 * abuse: even with the per-chunk cap and the per-message char cap, a
 * malicious caller iterating `index` to 10_000 would still slam the
 * rate-limiter. 200 covers an extraordinarily long honest reply.
 */
export const MAX_TTS_CHUNKS_PER_MESSAGE = 200;

/**
 * Minimum bytes a provider response must contain to be accepted as a
 * legitimate audio payload. A 200 OK with a near-empty body (provider
 * misconfiguration, partial outage, accidental JSON-error-as-success)
 * would otherwise be stored to `_storage` and fully billed despite
 * yielding no audible audio. Picked conservatively — even a single
 * frame of mp3/opus exceeds this by an order of magnitude.
 */
export const MIN_TTS_AUDIO_BYTES = 256;

/**
 * Hard cap on the client-side synthesis queue depth. The chunker
 * dispatches up to `MAX_IN_FLIGHT` actions concurrently and queues the
 * rest; without a depth cap a slow provider + fast streamer can stack
 * thousands of pending tasks. When the queue is full the chunker stops
 * segmenting and surfaces `QUEUE_OVERFLOW` so the user can see why
 * playback paused.
 */
export const MAX_TTS_QUEUE_DEPTH = 50;

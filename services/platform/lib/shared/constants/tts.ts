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

/**
 * Slack added to `PENDING_STALE_MS` for the server-side watchdog scheduled
 * by `reserveChunk`. If the action completes (mark-ready or mark-failed)
 * before the watchdog fires, the watchdog no-ops via the
 * `(chunkId, attemptCreatedAt)` identity gate. If the action crashes after
 * `ctx.storage.store` but before `markChunkReadyAndRecordUsage`, the
 * watchdog flips the row to `failed` so the player advances instead of
 * parking on a forever-pending chunk until the 7-day cron.
 */
export const TTS_WATCHDOG_BUFFER_MS = 5_000;

/**
 * Server-side upstream TTS fetch timeout. Sized for OpenAI tts-1 worst-
 * case latency on long inputs. The watchdog horizon (`PENDING_STALE_MS`
 * in `convex/tts/mutations.ts`) derives from this constant + a teardown
 * slack, so co-locating prevents the two from silently drifting on a
 * future tuning pass.
 */
export const TTS_FETCH_TIMEOUT_MS = 60_000;

// ─── Client-side chunking + retry knobs ────────────────────────────────
// These live next to the server bounds so a future bump (e.g. raising
// MAX_TTS_CHUNK_CHARS forces MIN_CHUNK_CHARS to scale) can be made in
// one place. Currently the chunker (`use-voice-output.ts`) is the sole
// consumer, but the file is the right home for any "TTS tuning knob"
// regardless of which side reads it.

/**
 * Minimum length (after `stripMarkdown`) before the chunker will emit a
 * mid-stream sentence segment. Shorter segments are held until more text
 * arrives or the stream ends, so isolated punctuation/emoji don't drive
 * an awkward synthesis call.
 */
export const MIN_TTS_CHUNK_CHARS = 12;

/**
 * Maximum concurrent in-flight `synthesizeChunk` actions per chunker
 * instance. Higher = lower latency on long replies but more bursty load
 * on the rate-limiter shards; 3 keeps p95 within the per-org rate-limit
 * envelope while still parallelising sentence pipelines.
 */
export const MAX_TTS_IN_FLIGHT = 3;

/**
 * Post-stream coalescing threshold. When a reply has finished streaming
 * and the remaining text is shorter than this, the chunker emits it as a
 * single chunk instead of one chunk per sentence. Each chunk is a
 * separate `<audio>` file load with a perceptible swap gap, so short
 * replies otherwise sound choppy (and isolated punctuation/emoji confuse
 * the model when sent alone).
 */
export const POST_STREAM_BATCH_MAX_CHARS = 300;

/** Maximum retries per chunk before surfacing a terminal failure. */
export const MAX_TTS_RETRIES_PER_CHUNK = 2;

/** Base delay for `RATE_LIMITED` retries (jittered up). */
export const TTS_RETRY_BASE_DELAY_MS = 1500;

/**
 * Base delay for `CONTENTION` retries — rate-limiter shard OCC, not
 * quota exhaustion. Much shorter than the `RATE_LIMITED` curve since
 * the limiter library's internal retry already lands on a free shard
 * within a few hundred ms.
 */
export const TTS_CONTENTION_BASE_DELAY_MS = 100;

/**
 * SR-announcer debounce: minimum hold time between two consecutive
 * announcements. Below this, rapid `state` transitions (e.g. playing →
 * stopped → playing on a fast skip) collapse to the latest snapshot so
 * the user doesn't hear "stopped" followed by "speaking" within 100ms.
 */
export const VOICE_ANNOUNCEMENT_HOLD_MS = 1500;

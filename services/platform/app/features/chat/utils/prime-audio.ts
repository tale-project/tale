/**
 * iOS Safari / WebKit audio-unlock primitive.
 *
 * Browsers gate `audio.play()` behind a user-activation token: a
 * synchronous gesture (click, tap, keydown) is required to consume the
 * token, and subsequent programmatic playback inherits it. Without
 * priming, the first chunk that arrives over the streaming TTS pipeline
 * would reject with `NotAllowedError`.
 *
 * The round-2 review found three related defects in the prior
 * silent-muted-WAV approach:
 *
 *  1. **`muted = true` plus 0-sample data is a no-op on WebKit**. iOS
 *     Safari treats a silent-muted prime as "you didn't really mean to
 *     play audio" and refuses to bank the activation. The fix is a
 *     `WebAudio` zero-gain `BufferSource` — WebKit accepts that as a
 *     legitimate audio start.
 *
 *  2. **Module-level `primed` latch never resets**. Activation expires
 *     when the user navigates back, switches tabs, or the bfcache
 *     restores the page; the latch left us thinking we were primed
 *     when we weren't. The new approach resumes the AudioContext on
 *     every call (cheap when already running) instead of latching.
 *
 *  3. **Prime element ≠ playback element**. Activation is per-
 *     `HTMLMediaElement` on iOS, so priming a throwaway element and
 *     then playing on a different one never transferred. The element
 *     to pre-warm is now passed in by the caller (typically the
 *     `<VoiceOutputProvider>`-owned audio element via context), so the
 *     prime lands on the element the player will actually use.
 *
 * Per-provider ownership (round-5 finding #23): an earlier module-
 * level singleton meant arena split-view's two `<VoiceOutputProvider>`
 * instances shared one `<audio>` element and corrupted each other's
 * `src`. Each provider now owns its own element via `useMemo`; this
 * helper just pre-warms whatever element it's handed.
 */

let audioContext: AudioContext | null = null;

interface AudioContextGlobals {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

function getOrCreateContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- feature-detect WebKit's prefixed constructor; `AudioContextGlobals` only marks both as optional
  const globals = window as unknown as AudioContextGlobals;
  const Ctor = globals.AudioContext ?? globals.webkitAudioContext;
  if (!Ctor) return null;
  if (audioContext) return audioContext;
  try {
    audioContext = new Ctor();
    return audioContext;
  } catch (err) {
    console.warn('[tts.prime] AudioContext construction failed', err);
    return null;
  }
}

/**
 * Consume the current user-activation token by scheduling a zero-gain
 * `BufferSource` and (asynchronously) resuming the WebAudio context.
 * When `el` is supplied, the call ALSO pre-warms that element with a
 * silent `load()` inside the same gesture so the activation transfers
 * to it for later `el.play()` calls.
 *
 * **Must run synchronously through `source.start()`**: WebKit consumes
 * the user-activation token at the first `await`, so any work that
 * needs the token (notably `source.start()`) must be scheduled before
 * any `await` is reached. The `ctx.resume()` call is fire-and-forget
 * at the end — its promise is allowed to settle whenever, since the
 * activation was already banked by the synchronous source-start above.
 *
 * Safe to call multiple times: resuming an already-running context is
 * a no-op, and the 1-sample zero-gain source is inaudible.
 */
export function primeAudio(el?: HTMLAudioElement | null): void {
  const ctx = getOrCreateContext();
  if (!ctx) return;
  try {
    // Pre-warm the caller-supplied playback element inside the same
    // gesture so the activation token transfers when the player picks
    // it up. iOS Safari's activation is per-HTMLMediaElement; without
    // this transfer, priming was useless to a separate element.
    if (el) configurePlaybackElement(el);
    // Schedule a zero-gain buffer source synchronously to bank the
    // activation. WebKit accepts a started `BufferSource` as a
    // legitimate audio start even on a suspended context (the schedule
    // queues against `currentTime` and plays once the context resumes).
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    source.stop(ctx.currentTime + 0.001);
    // Fire-and-forget resume. MUST NOT be awaited above the source
    // schedule: an `await` here drops the activation on WebKit and
    // the unlock silently fails.
    if (ctx.state === 'suspended') {
      ctx.resume().catch((err) => {
        console.warn('[tts.prime] resume rejected', err);
      });
    }
  } catch (err) {
    console.warn('[tts.prime] silent prime rejected', err);
  }
}

/**
 * Apply the standard playback-element configuration: `playsinline` so
 * iOS Safari doesn't full-screen-takeover audio, `preload="auto"` so
 * chunked-swap playback keeps bytes warm between sources. Idempotent.
 *
 * Exposed so callers that construct their own `<audio>` element (the
 * per-provider context, the player's fallback path) apply the same
 * config without duplicating these two lines.
 */
export function configurePlaybackElement(el: HTMLAudioElement): void {
  // `playsinline` lets iOS Safari play without the full-screen
  // takeover. Set via attribute because `HTMLAudioElement`'s
  // TypeScript declarations don't surface the property even though
  // WebKit honours it on `<audio>` elements too.
  el.setAttribute('playsinline', '');
  el.preload = 'auto';
}

/**
 * Construct a fresh playback element with the standard config. Each
 * `<VoiceOutputProvider>` instantiates one via `useMemo` so split-view
 * arenas don't share an element (the prior module-level singleton let
 * two providers stomp each other's `src`).
 *
 * Returns `null` in SSR / non-browser environments. The caller should
 * fall back gracefully (the player keeps a `new Audio()` fallback for
 * the same reason).
 */
export function createPlaybackElement(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    return null;
  }
  try {
    const el = new Audio();
    configurePlaybackElement(el);
    return el;
  } catch (err) {
    console.warn('[tts.prime] audio element construction failed', err);
    return null;
  }
}

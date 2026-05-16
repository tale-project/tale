/**
 * iOS Safari / WebKit audio-unlock primitive.
 *
 * Browsers gate `audio.play()` behind a user-activation token: a
 * synchronous gesture (click, tap, keydown) is required to consume the
 * token, and subsequent programmatic playback inherits it. Without
 * priming, the first chunk that arrives over the streaming TTS pipeline
 * would reject with `NotAllowedError`.
 *
 * The round-2 review found two related defects in the prior
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
 *  3. **Prime element ≠ playback element**. The prior code primed a
 *     throwaway `Audio()` but the player constructed a *different*
 *     `new Audio()` later — activation is per-`HTMLMediaElement` on iOS
 *     so the prime never transferred. `getPrimedAudioElement()` returns
 *     a module-level singleton so the player picks up the same element
 *     that was primed.
 */

let audioContext: AudioContext | null = null;
let primedElement: HTMLAudioElement | null = null;

interface AudioContextGlobals {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

function getOrCreateContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
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
 * Consume the current user-activation token by resuming a WebAudio
 * context and scheduling a single zero-gain buffer source. Must be
 * called synchronously inside a user-gesture handler — moving it after
 * an `await` loses the activation.
 *
 * Safe to call multiple times: resuming an already-running context is
 * a no-op, and the zero-gain source is too short to produce audible
 * artifacts. The returned promise resolves when the prime succeeds,
 * rejects when the browser refuses (no remedy here — the player will
 * fall back to `'blocked'` and a real gesture on the indicator).
 */
export async function primeAudio(): Promise<void> {
  const ctx = getOrCreateContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    // Pre-warm the singleton playback element inside the same gesture
    // so the activation token transfers when the player picks it up.
    getPrimedAudioElement();
    // Schedule a zero-gain buffer source to confirm WebKit accepts the
    // unlock. The 1-sample source is short enough to be inaudible even
    // before the gain node clamps it.
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    source.stop(ctx.currentTime + 0.001);
  } catch (err) {
    console.warn('[tts.prime] silent prime rejected', err);
  }
}

/**
 * Return the module-level singleton `<audio>` element used for chunked
 * TTS playback. The player calls this when it needs to construct an
 * element so the activation token banked by `primeAudio()` transfers
 * to the same element that will later play the chunks — without this,
 * iOS Safari would reject the chunked playback because the prime
 * activated a *different* element.
 */
export function getPrimedAudioElement(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    return null;
  }
  if (primedElement) return primedElement;
  try {
    primedElement = new Audio();
    // `playsinline` lets iOS Safari play without the full-screen
    // takeover. Set via attribute because `HTMLAudioElement`'s
    // TypeScript declarations don't surface the property even though
    // WebKit honours it on `<audio>` elements too. Combined with
    // `preload = 'auto'`, the element keeps its bytes around between
    // chunk swaps.
    primedElement.setAttribute('playsinline', '');
    primedElement.preload = 'auto';
    return primedElement;
  } catch (err) {
    console.warn('[tts.prime] audio element construction failed', err);
    return null;
  }
}

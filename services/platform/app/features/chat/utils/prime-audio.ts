// Silent 1-frame WAV; played to prime the iOS / Safari user-gesture
// requirement so a later programmatic `play()` from auto-start doesn't
// reject with NotAllowedError.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

let primed = false;

/**
 * Consume the current user-activation token by triggering muted playback
 * of a silent WAV. Must be called synchronously inside a user gesture
 * handler — moving it after an async hop loses the gesture.
 *
 * Idempotent across the page lifetime; subsequent calls no-op once the
 * first prime has succeeded.
 */
export function primeAudio(): void {
  if (primed) return;
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
  try {
    const el = new Audio(SILENT_WAV);
    el.muted = true;
    void el.play().then(
      () => {
        el.pause();
        primed = true;
      },
      () => {
        // Best-effort; if the browser rejects the silent prime there's
        // no remedy here — the player hook will surface `'blocked'` and
        // a real gesture on the indicator can start playback.
      },
    );
  } catch (err) {
    console.warn('[tts.prime] audio prime failed', err);
  }
}

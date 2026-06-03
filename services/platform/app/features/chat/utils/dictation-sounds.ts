/**
 * Short audio cues played when speech-to-text starts/stops. Two distinct
 * tones so the user gets immediate non-visual feedback that the
 * microphone is now live (or just released) — important for screen-reader
 * users and for anyone whose eyes are on the input field rather than the
 * mic button.
 *
 * Implementation notes:
 *  - Uses Web Audio (`OscillatorNode`) rather than `<audio>` so we don't
 *    have to ship a sample file. The tones are < 150 ms each.
 *  - The context is created lazily on first call; if the browser blocks
 *    autoplay until a user gesture, the call falls through silently —
 *    activating dictation is itself a gesture, so playback works.
 *  - A short attack/release envelope avoids the click/pop you get from
 *    instantaneously starting and stopping a square-shape signal.
 */

import { type AudioContextGlobals } from './audio-context';

let cachedContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (cachedContext && cachedContext.state !== 'closed') return cachedContext;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- feature-detect WebKit's prefixed AudioContext; only marks both as optional
  const globals = window as unknown as AudioContextGlobals;
  const Ctor = globals.AudioContext ?? globals.webkitAudioContext;
  if (!Ctor) return null;
  try {
    cachedContext = new Ctor();
    return cachedContext;
  } catch (err) {
    console.warn('[dictation.sound] AudioContext construction failed', err);
    return null;
  }
}

function playTone(startFreq: number, endFreq: number, durationMs: number) {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    ctx.resume().catch((err) => {
      console.warn('[dictation.sound] resume rejected', err);
    });
  }

  try {
    const now = ctx.currentTime;
    const duration = durationMs / 1000;

    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(startFreq, now);
    oscillator.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

    const gain = ctx.createGain();
    // Short attack/release so the tone doesn't click; peak gain kept low
    // (0.15) so the cue is noticeable but not jarring.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.015);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  } catch (err) {
    console.warn('[dictation.sound] tone playback failed', err);
  }
}

/** Rising blip — "mic is now live". */
export function playDictationStartSound(): void {
  playTone(660, 990, 120);
}

/** Falling blip — "mic is now off". */
export function playDictationStopSound(): void {
  playTone(880, 520, 140);
}

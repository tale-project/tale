'use client';

import { useEffect, useRef, useState } from 'react';

import { type AudioContextGlobals } from '../utils/audio-context';

interface UseMicrophoneLevelOptions {
  /** When true, opens a microphone stream and reports the RMS level. */
  enabled: boolean;
}

/**
 * Live RMS level (0..1) from the user's microphone while `enabled` is
 * true. Designed to drive a small "volume" indicator next to the
 * dictation button so the user sees that audio is actually being picked
 * up.
 *
 * We open our own `getUserMedia` stream rather than tap into the active
 * dictation stream because the Web Speech API (Chrome / Safari) never
 * exposes the stream it uses internally. Opening a parallel stream is
 * cheap — the browser shares the same hardware capture, and the user
 * has already granted mic permission to start dictation, so no extra
 * prompt fires.
 *
 * The hook intentionally fails silently:
 *  - Permission denied / no mic / unsupported AudioContext → level stays
 *    at 0. The dictation flow itself surfaces a toast about microphone
 *    permission, so we don't duplicate that error here.
 */
export function useMicrophoneLevel({ enabled }: UseMicrophoneLevelOptions) {
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof window === 'undefined') return undefined;
    if (!navigator.mediaDevices?.getUserMedia) return undefined;

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- feature-detect WebKit's prefixed AudioContext
    const globals = window as unknown as AudioContextGlobals;
    const Ctor = globals.AudioContext ?? globals.webkitAudioContext;
    if (!Ctor) return undefined;

    let cancelled = false;

    const cleanup = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
        streamRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch((err) => {
          console.warn('[dictation.level] AudioContext close failed', err);
        });
        audioContextRef.current = null;
      }
      setLevel(0);
    };

    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        console.warn('[dictation.level] getUserMedia failed', err);
        return;
      }

      if (cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      streamRef.current = stream;

      let context: AudioContext;
      try {
        context = new Ctor();
      } catch (err) {
        console.warn('[dictation.level] AudioContext construction failed', err);
        for (const track of stream.getTracks()) track.stop();
        streamRef.current = null;
        return;
      }
      audioContextRef.current = context;

      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);

      const buffer = new Uint8Array(analyser.fftSize);

      const tick = () => {
        if (cancelled) return;
        // `getByteTimeDomainData` returns samples centred on 128. RMS of
        // the centred samples gives a stable volume proxy; mapping it
        // through a soft curve makes quiet speech read as "something"
        // rather than disappearing into the noise floor.
        analyser.getByteTimeDomainData(buffer);
        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i++) {
          const centred = (buffer[i] - 128) / 128;
          sumSquares += centred * centred;
        }
        const rms = Math.sqrt(sumSquares / buffer.length);
        // Empirical floor/ceiling that maps a normal speaking voice to
        // ~0.4–0.9. Without the floor, ambient noise pegs the bar near 0.05.
        const normalised = Math.min(1, Math.max(0, (rms - 0.015) / 0.25));
        setLevel(normalised);
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [enabled]);

  return level;
}

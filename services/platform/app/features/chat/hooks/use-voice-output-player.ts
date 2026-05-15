'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useLocale } from '@/app/hooks/use-locale';

import { useVoiceChunks } from './use-voice-output';
import { useVoiceOutputCoordinator } from './voice-output-context';

type ChunkRecord = {
  index: number;
  status: 'pending' | 'ready' | 'failed';
  url: string | null;
  voice?: string;
  format?: string;
  error?: string;
  text: string;
};

function localeToBcp47(locale: string): string {
  if (locale.includes('-')) return locale;
  switch (locale) {
    case 'en':
      return 'en-US';
    case 'de':
      return 'de-DE';
    case 'fr':
      return 'fr-FR';
    default:
      return locale;
  }
}

export type VoicePlayerStateName = 'idle' | 'playing' | 'blocked' | 'error';

export interface VoicePlayerState {
  state: VoicePlayerStateName;
  hasAudio: boolean;
  /** Short token derived from the first failed chunk's stored error, e.g.
   * `'NO_PROVIDER'`, `'RATE_LIMITED'`. `undefined` when no chunk failed. */
  errorCode?: string;
  play: () => void;
  stop: () => void;
}

/**
 * Plays back the ordered audio chunks for a message as they appear. Auto-
 * starts only when chunks arrive AFTER the hook has observed `isStreaming
 * === true` — historical chunks on a remount (e.g. revisiting a thread) do
 * NOT trigger automatic replay.
 *
 * Chains the `<audio>` element through chunks via an `ended` listener.
 * Falls back to `window.speechSynthesis` for any chunk whose server
 * synthesis failed (server returns a stable `errorCode` token) OR whose
 * audio element rejects decode (codec mismatch).
 *
 * When `play()` rejects with `NotAllowedError` (autoplay policy), the
 * state transitions to `'blocked'` so the indicator can render a "Tap
 * to play" affordance.
 */
export function useVoiceOutputPlayer(opts: {
  enabled: boolean;
  messageId: string | undefined;
  threadId: string | undefined;
  isStreaming: boolean;
}): VoicePlayerState {
  const { locale } = useLocale();
  const coordinator = useVoiceOutputCoordinator();
  const chunks = useVoiceChunks(opts.messageId, opts.threadId);
  const [state, setState] = useState<VoicePlayerStateName>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioListenersRef = useRef<{
    ended: () => void;
    error: () => void;
  } | null>(null);
  const nextIndexRef = useRef(0);
  const activeRef = useRef(false);
  const currentUttRef = useRef<SpeechSynthesisUtterance | null>(null);
  const uttListenersRef = useRef<{
    end: () => void;
    error: (ev: SpeechSynthesisErrorEvent) => void;
  } | null>(null);
  const chunksRef = useRef<ChunkRecord[] | undefined>(undefined);
  const localeRef = useRef(locale);
  // Tracks whether the message was streaming at some point since mount.
  // Auto-play only fires when chunks grow under that flag — prevents
  // historical-audio replay on thread revisit (review H8).
  const sawStreamingRef = useRef(false);
  // One-shot guard so each (messageId, mount) pair auto-plays at most once.
  const hasAutoStartedRef = useRef(false);

  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  useEffect(() => {
    if (opts.isStreaming) sawStreamingRef.current = true;
  }, [opts.isStreaming]);

  const tryAdvanceRef = useRef<() => boolean>(() => false);

  const detachAudioListeners = useCallback(() => {
    if (audioRef.current && audioListenersRef.current) {
      audioRef.current.removeEventListener(
        'ended',
        audioListenersRef.current.ended,
      );
      audioRef.current.removeEventListener(
        'error',
        audioListenersRef.current.error,
      );
      audioListenersRef.current = null;
    }
  }, []);

  const detachUtteranceListeners = useCallback(() => {
    if (currentUttRef.current && uttListenersRef.current) {
      currentUttRef.current.removeEventListener(
        'end',
        uttListenersRef.current.end,
      );
      currentUttRef.current.removeEventListener(
        'error',
        uttListenersRef.current.error,
      );
      uttListenersRef.current = null;
    }
  }, []);

  const stopRef = useRef<() => void>(() => {});

  const stop = useCallback(() => {
    activeRef.current = false;
    detachAudioListeners();
    detachUtteranceListeners();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      try {
        audioRef.current.load();
      } catch (err) {
        console.warn('[tts.player] audio.load() after stop failed', err);
      }
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    currentUttRef.current = null;
    coordinator.release(stopRef.current);
    setState('idle');
  }, [detachAudioListeners, detachUtteranceListeners, coordinator]);

  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const speakFallback = useCallback((chunk: ChunkRecord): boolean => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return false;
    }
    const trimmed = chunk.text.trim();
    if (trimmed.length === 0) {
      nextIndexRef.current = chunk.index + 1;
      return tryAdvanceRef.current();
    }
    const utt = new SpeechSynthesisUtterance(trimmed);
    utt.lang = localeToBcp47(localeRef.current);
    const onEnd = () => {
      if (currentUttRef.current !== utt) return;
      nextIndexRef.current = chunk.index + 1;
      tryAdvanceRef.current();
    };
    const onErr = (ev: SpeechSynthesisErrorEvent) => {
      console.error('[tts.player] speechSynthesis error', ev.error);
      nextIndexRef.current = chunk.index + 1;
      tryAdvanceRef.current();
    };
    utt.addEventListener('end', onEnd);
    utt.addEventListener('error', onErr);
    currentUttRef.current = utt;
    uttListenersRef.current = { end: onEnd, error: onErr };
    window.speechSynthesis.speak(utt);
    setState('playing');
    return true;
  }, []);

  const playChunk = useCallback(
    (chunk: ChunkRecord): boolean => {
      if (chunk.status === 'ready' && chunk.url) {
        if (!audioRef.current) {
          audioRef.current = new Audio();
        }
        const el = audioRef.current;
        detachAudioListeners();
        el.src = chunk.url;
        const onEnded = () => {
          nextIndexRef.current = chunk.index + 1;
          tryAdvanceRef.current();
        };
        const onError = () => {
          console.warn(
            '[tts.player] audio element decode error; falling back to speechSynthesis',
          );
          // Codec / corrupted-blob fallback: route the chunk's text
          // through browser TTS so the user still hears something.
          detachAudioListeners();
          speakFallback(chunk);
        };
        el.addEventListener('ended', onEnded);
        el.addEventListener('error', onError);
        audioListenersRef.current = { ended: onEnded, error: onError };
        void el.play().catch((err) => {
          if (err instanceof Error && err.name === 'NotAllowedError') {
            console.warn(
              '[tts.player] play() blocked by autoplay policy; awaiting gesture',
            );
            setState('blocked');
          } else {
            console.error('[tts.player] play() rejected', err);
            setState('error');
          }
        });
        setState('playing');
        return true;
      }
      if (chunk.status === 'failed') {
        return speakFallback(chunk);
      }
      // status === 'pending' — wait for the next subscription tick.
      return false;
    },
    [detachAudioListeners, speakFallback],
  );

  const tryAdvance = useCallback((): boolean => {
    if (!activeRef.current) return false;
    const list = chunksRef.current;
    if (!list || list.length === 0) return false;
    const target = list.find((c) => c.index === nextIndexRef.current);
    if (!target) {
      const maxIndex = list[list.length - 1].index;
      if (nextIndexRef.current > maxIndex) {
        activeRef.current = false;
        coordinator.release(stopRef.current);
        setState('idle');
      }
      return false;
    }
    return playChunk(target);
  }, [playChunk, coordinator]);

  useEffect(() => {
    tryAdvanceRef.current = tryAdvance;
  }, [tryAdvance]);

  useEffect(() => {
    chunksRef.current = chunks ?? undefined;
    if (activeRef.current) {
      tryAdvance();
    }
  }, [chunks, tryAdvance]);

  const play = useCallback(() => {
    coordinator.claim(stopRef.current);
    activeRef.current = true;
    nextIndexRef.current = 0;
    tryAdvance();
  }, [coordinator, tryAdvance]);

  // Auto-play: fires once per (messageId, mount) only when chunks grow
  // while `isStreaming` was true since mount. Historical chunks on
  // remount do not auto-play (review H8).
  useEffect(() => {
    if (!opts.enabled) return;
    if (hasAutoStartedRef.current) return;
    if (activeRef.current) return;
    if (!sawStreamingRef.current) return;
    if (!chunks || chunks.length === 0) return;
    const playable = chunks.find(
      (c) => c.status === 'ready' || c.status === 'failed',
    );
    if (!playable) return;
    hasAutoStartedRef.current = true;
    play();
  }, [opts.enabled, chunks, play]);

  // Reset auto-play guard + stop on message change.
  useEffect(() => {
    hasAutoStartedRef.current = false;
    sawStreamingRef.current = opts.isStreaming;
    return () => {
      stop();
    };
  }, [opts.messageId, opts.isStreaming, stop]);

  useEffect(() => {
    if (!opts.enabled) {
      stop();
    }
  }, [opts.enabled, stop]);

  // Derive a short error code from the first failed chunk so the indicator
  // can branch on it (review H6a: surface chunk.error). Stored shape is
  // `"<CODE>: <detail>"` or just `<CODE>`; take the head.
  const failed = chunks?.find((c) => c.status === 'failed');
  const errorCode = failed?.error
    ? failed.error.split(':')[0]?.trim() || undefined
    : undefined;

  const hasAudio = (chunks?.length ?? 0) > 0;

  return { state, hasAudio, errorCode, play, stop };
}

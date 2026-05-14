'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useLocale } from '@/app/hooks/use-locale';

import { useVoiceChunks } from './use-voice-output';

type ChunkRecord = {
  index: number;
  status: 'pending' | 'ready' | 'failed';
  url: string | null;
  voice?: string;
  format?: string;
  error?: string;
  text: string;
};

// Module-level coordinator so a second assistant message playing back
// preempts any earlier message that is still mid-playback.
let activeStopper: (() => void) | null = null;

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

export interface VoicePlayerState {
  state: 'idle' | 'playing' | 'paused' | 'error';
  hasAudio: boolean;
  play: () => void;
  stop: () => void;
}

/**
 * Plays back the ordered audio chunks for a message as they appear.
 * Auto-starts once `enabled` is true and at least one chunk is `ready` /
 * `failed`. Chains the `<audio>` element through chunks via an `ended`
 * listener, falling back to `window.speechSynthesis` for any chunk whose
 * server synthesis failed (typically `NO_PROVIDER`).
 */
export function useVoiceOutputPlayer(opts: {
  enabled: boolean;
  messageId: string | undefined;
  threadId: string | undefined;
}): VoicePlayerState {
  const { locale } = useLocale();
  const chunks = useVoiceChunks(opts.messageId, opts.threadId);
  const [state, setState] = useState<'idle' | 'playing' | 'paused' | 'error'>(
    'idle',
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioListenersRef = useRef<{
    ended: () => void;
    error: () => void;
  } | null>(null);
  const nextIndexRef = useRef(0);
  const activeRef = useRef(false);
  const currentUttRef = useRef<SpeechSynthesisUtterance | null>(null);
  const chunksRef = useRef<ChunkRecord[] | undefined>(undefined);
  const localeRef = useRef(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

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

  const stop = useCallback(() => {
    activeRef.current = false;
    detachAudioListeners();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    currentUttRef.current = null;
    if (activeStopper === stop) activeStopper = null;
    setState('idle');
  }, [detachAudioListeners]);

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
          console.error('[tts.player] audio element error');
          nextIndexRef.current = chunk.index + 1;
          tryAdvanceRef.current();
        };
        el.addEventListener('ended', onEnded);
        el.addEventListener('error', onError);
        audioListenersRef.current = { ended: onEnded, error: onError };
        void el.play().catch((err) => {
          console.error('[tts.player] play() rejected', err);
          setState('error');
        });
        setState('playing');
        return true;
      }
      if (chunk.status === 'failed') {
        if (chunk.text.trim().length === 0) {
          nextIndexRef.current = chunk.index + 1;
          return tryAdvanceRef.current();
        }
        const utt = new SpeechSynthesisUtterance(chunk.text);
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
        window.speechSynthesis.speak(utt);
        setState('playing');
        return true;
      }
      // status === 'pending' — wait for the next subscription tick.
      return false;
    },
    [detachAudioListeners],
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
        if (activeStopper === stop) activeStopper = null;
        setState('idle');
      }
      return false;
    }
    return playChunk(target);
  }, [playChunk, stop]);

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
    if (activeStopper && activeStopper !== stop) {
      activeStopper();
    }
    activeStopper = stop;
    activeRef.current = true;
    nextIndexRef.current = 0;
    tryAdvance();
  }, [stop, tryAdvance]);

  useEffect(() => {
    if (!opts.enabled) return;
    if (activeRef.current) return;
    if (!chunks || chunks.length === 0) return;
    const playable = chunks.find(
      (c) => c.status === 'ready' || c.status === 'failed',
    );
    if (!playable) return;
    play();
  }, [opts.enabled, chunks, play]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [opts.messageId, stop]);

  useEffect(() => {
    if (!opts.enabled) {
      stop();
    }
  }, [opts.enabled, stop]);

  const hasAudio = (chunks?.length ?? 0) > 0;

  return { state, hasAudio, play, stop };
}

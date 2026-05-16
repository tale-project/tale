'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getEnv } from '@/lib/env';

import { getPrimedAudioElement } from '../utils/prime-audio';
import { useVoiceChunks } from './use-voice-output';
import { useVoiceOutputCoordinator } from './voice-output-context';

type ChunkRecord = {
  chunkId: string;
  index: number;
  status: 'pending' | 'ready' | 'failed';
  voice?: string;
  format?: string;
  error?: string;
  text: string;
  createdAt: number;
};

/**
 * Build the URL the `<audio>` element fetches for a given chunk. Routes
 * through the authenticated `/api/tts-audio` Convex HTTP handler so each
 * fetch is gated on org membership — replaces the previous
 * `_storage` direct URL which was bearer-replayable for the row's
 * 7-day lifetime.
 */
function buildTtsAudioUrl(chunkId: string): string {
  const siteUrl = getEnv('SITE_URL');
  const basePath = getEnv('BASE_PATH');
  return `${siteUrl}${basePath}/http_api/api/tts-audio?chunkId=${encodeURIComponent(chunkId)}`;
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
 * starts only on chunks whose `createdAt` is later than the hook's mount
 * time — chunks already present at mount are historical (e.g. revisiting
 * a thread) and must NOT trigger automatic replay.
 *
 * The mount-time comparison is the only signal that reliably distinguishes
 * a fresh generation from a thread-history load: ultra-fast assistant
 * replies finish streaming before the bubble even sees `isStreaming=true`,
 * so a streaming-watch heuristic misses them.
 *
 * Chains the `<audio>` element through chunks via an `ended` listener.
 * Provider-only: failed chunks are skipped (their error surfaces via the
 * indicator's `errorCode`) rather than re-spoken through the browser's
 * speechSynthesis. Mixing provider audio with browser TTS mid-message
 * produces jarring voice-style drift; either the provider works for the
 * whole reply or the user sees an error and configures their setup.
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
  const chunksRef = useRef<ChunkRecord[] | undefined>(undefined);
  // Index of the chunk currently playing (or `null` when idle). Guards
  // against `tryAdvance()` restarting an in-flight chunk every time the
  // chunks subscription fires — without this, each new ready chunk that
  // arrives mid-playback restarts whatever's already speaking, so the user
  // hears each chunk repeated multiple times on long structured replies.
  const currentChunkIndexRef = useRef<number | null>(null);
  // Hook-mount wall-clock timestamp. Any chunk with `createdAt > mountTime`
  // was produced during this mount → fresh, eligible for auto-play.
  // Anything with `createdAt <= mountTime` is historical (loaded from
  // thread history) → must not auto-play.
  const mountTimeRef = useRef(Date.now());
  // One-shot guard so each (messageId, mount) pair auto-plays at most once.
  const hasAutoStartedRef = useRef(false);

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

  const stopRef = useRef<() => void>(() => {});

  const stop = useCallback(() => {
    activeRef.current = false;
    detachAudioListeners();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      try {
        audioRef.current.load();
      } catch (err) {
        console.warn('[tts.player] audio.load() after stop failed', err);
      }
      // Drop the element reference. Without this, the previous chunk's
      // buffer + URL stayed pinned in memory after stop() — a long
      // session with many stop/resume cycles would otherwise grow heap
      // unbounded.
      audioRef.current = null;
    }
    currentChunkIndexRef.current = null;
    coordinator.release(stopRef.current);
    setState('idle');
  }, [detachAudioListeners, coordinator]);

  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const playChunk = useCallback(
    (chunk: ChunkRecord): boolean => {
      if (chunk.status === 'ready') {
        if (currentChunkIndexRef.current === chunk.index) {
          // Already playing this chunk; subscription updates that re-run
          // tryAdvance() must not restart it from the beginning.
          return true;
        }
        if (!audioRef.current) {
          // Prefer the module-level singleton from `prime-audio.ts` so
          // the iOS Safari activation token banked at toggle/send time
          // transfers to the same element that will actually play the
          // chunks. Falls back to a fresh `new Audio()` in environments
          // where the singleton couldn't be constructed (SSR, etc.).
          audioRef.current = getPrimedAudioElement() ?? new Audio();
        }
        const el = audioRef.current;
        detachAudioListeners();
        el.src = buildTtsAudioUrl(chunk.chunkId);
        currentChunkIndexRef.current = chunk.index;
        const onEnded = () => {
          currentChunkIndexRef.current = null;
          nextIndexRef.current = chunk.index + 1;
          tryAdvanceRef.current();
        };
        const onError = () => {
          // Decode / fetch failure on a chunk the server marked ready —
          // skip it (the chunk row carries no errorCode in this case, so
          // we only log; the indicator stays in its current state and the
          // next chunk continues the playback).
          console.warn(
            '[tts.player] audio element decode error; skipping chunk',
            chunk.index,
          );
          detachAudioListeners();
          currentChunkIndexRef.current = null;
          nextIndexRef.current = chunk.index + 1;
          tryAdvanceRef.current();
        };
        el.addEventListener('ended', onEnded);
        el.addEventListener('error', onError);
        audioListenersRef.current = { ended: onEnded, error: onError };
        void el.play().catch((err) => {
          if (err instanceof Error && err.name === 'NotAllowedError') {
            console.warn(
              '[tts.player] play() blocked by autoplay policy; awaiting gesture',
            );
            // Reset playback state so the user's subsequent tap-to-play
            // gesture re-invokes `el.play()` instead of being short-
            // circuited by the "already playing this chunk" guard above.
            // Without this, the `'blocked'` state was unrecoverable on
            // iOS Safari — the only fix was a full reload.
            detachAudioListeners();
            currentChunkIndexRef.current = null;
            setState('blocked');
          } else if (err instanceof Error && err.name === 'AbortError') {
            // StrictMode double-mount + cleanup races produce AbortError
            // when a previous `play()` is interrupted by `pause()` /
            // `src` swap. Not a user-facing failure — the new attempt
            // takes over, no state change needed.
          } else {
            console.error('[tts.player] play() rejected', err);
            setState('error');
          }
        });
        setState('playing');
        return true;
      }
      if (chunk.status === 'failed') {
        // Provider returned a failure for this chunk (NO_PROVIDER,
        // RATE_LIMITED, BUDGET_EXCEEDED, etc). Advance past it; the
        // error is surfaced via `errorCode` on the indicator so the
        // user can act on it without us swapping in a different voice.
        currentChunkIndexRef.current = null;
        nextIndexRef.current = chunk.index + 1;
        return tryAdvanceRef.current();
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

  // Auto-play: fires once per (messageId, mount) only when a ready chunk
  // produced after mount appears. Historical chunks (createdAt <= mount)
  // are loaded from thread history and must not auto-replay.
  useEffect(() => {
    if (!opts.enabled) return;
    if (hasAutoStartedRef.current) return;
    if (activeRef.current) return;
    if (!chunks || chunks.length === 0) return;
    const playable = chunks.find(
      (c) => c.status === 'ready' && c.createdAt > mountTimeRef.current,
    );
    if (!playable) return;
    hasAutoStartedRef.current = true;
    play();
  }, [opts.enabled, chunks, play]);

  // Reset auto-play guard + stop on message change. Do NOT reset
  // mountTimeRef here — it must keep its first-render value so the
  // "is this chunk fresh?" comparison is stable. Re-running this effect
  // (e.g. when `stop`'s identity churns) would otherwise bump mountTime
  // forward and reclassify the fresh chunk as historical, killing
  // auto-play.
  useEffect(() => {
    hasAutoStartedRef.current = false;
    return () => {
      stop();
    };
  }, [opts.messageId, stop]);

  useEffect(() => {
    if (!opts.enabled) {
      stop();
      return;
    }
    // Allow auto-play to fire again on a fresh OFF→ON cycle in the same
    // message — otherwise a user who toggles voice off then on mid-stream
    // would have to manually press play to hear the remaining chunks.
    hasAutoStartedRef.current = false;
  }, [opts.enabled, stop]);

  // Stop playback when the tab goes hidden. The browser stops emitting
  // sound in many cases (depending on mediaSession), but the `<audio>`
  // element keeps its `timeupdate` callbacks firing — wasting battery
  // on mobile and producing privacy-surprising playback if the user
  // unmutes after switching tabs. `pagehide` is the canonical
  // bfcache-aware unmount signal on iOS Safari.
  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    const onPageHide = () => stop();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [stop]);

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

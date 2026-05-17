'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getEnv } from '@/lib/env';

import { configurePlaybackElement, primeAudio } from '../utils/prime-audio';
import { useVoiceChunks } from './use-voice-output';
import {
  useActivePlaybackWriter,
  useVoiceAnnouncerWriter,
  useVoiceAudioElement,
  useVoiceOutputCoordinator,
  useVoicePreReservationError,
} from './voice-output-context';

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
  /**
   * True iff at least one chunk row for this message has reached
   * `status === 'ready'`. Distinct from `hasPendingChunk` so the
   * indicator can keep the "Preparing voice…" loading state visible
   * while synthesis is in flight — previously a single `hasAudio`
   * (`chunks.length > 0`) flipped true on the first pending row and
   * caused a brief "idle Play" flash before audio actually started.
   */
  hasReadyChunk: boolean;
  /**
   * True iff at least one chunk row has `status === 'pending'`.
   * Indicator keeps the loading chip up while this is true and
   * `hasReadyChunk` is false; the assistant-message content uses it
   * (combined with `isFreshSinceMount`) to keep text hidden until
   * the first ready chunk arrives.
   */
  hasPendingChunk: boolean;
  /** Short token derived from the first failed chunk's stored error, e.g.
   * `'NO_PROVIDER'`, `'RATE_LIMITED'`. `undefined` when no chunk failed. */
  errorCode?: string;
  /**
   * Index of the chunk currently playing, or `null` when idle / blocked
   * / errored. State-backed (not ref) so consumers re-render on change.
   * Used by the paragraph-level spotlight matcher to resolve which
   * paragraph of the rendered message corresponds to the active chunk.
   */
  currentChunkIndex: number | null;
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
  const providerAudioElement = useVoiceAudioElement();
  const chunks = useVoiceChunks(opts.messageId, opts.threadId);
  // Per-message pre-reservation error (BUDGET_EXCEEDED,
  // MESSAGE_CHAR_LIMIT, RATE_LIMITED, forbidden, …) surfaced by the
  // chunker via `voice-output-context`'s sink. Merged into `errorCode`
  // below so the indicator's switch can act on it.
  const preReservationError = useVoicePreReservationError(opts.messageId);
  // Announcer writer: every state transition publishes to the
  // chat-level live region so screen-reader users hear "Voice output
  // playing", "Voice output blocked", etc. without nesting an
  // aria-live span inside the per-message indicator (which over-
  // announced against the parent chat log).
  const announce = useVoiceAnnouncerWriter();
  // Publishes `{messageId, chunkIndex}` to the shared active-playback
  // store so non-player consumers (paragraph-spotlight content renderer)
  // can subscribe without re-instantiating the player.
  const publishActivePlayback = useActivePlaybackWriter();
  const [state, setState] = useState<VoicePlayerStateName>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioListenersRef = useRef<{
    ended: () => void;
    error: () => void;
  } | null>(null);
  const nextIndexRef = useRef(0);
  const activeRef = useRef(false);
  const chunksRef = useRef<ChunkRecord[] | undefined>(undefined);
  // Counter incremented every time the `<audio>` element emits an `error`
  // for a ready chunk (decode failure, 404 on the audio route, etc.). When
  // every ready chunk has failed and the message is no longer streaming,
  // we surface a synthetic `AUDIO_DECODE` error code to the indicator so
  // the user sees an actionable error instead of an inexplicable silence.
  // Reset on every `play()` so retries don't inherit prior failures.
  const decodeFailureCountRef = useRef(0);
  // Index of the chunk currently playing (or `null` when idle). Guards
  // against `tryAdvance()` restarting an in-flight chunk every time the
  // chunks subscription fires — without this, each new ready chunk that
  // arrives mid-playback restarts whatever's already speaking, so the user
  // hears each chunk repeated multiple times on long structured replies.
  //
  // Also published to consumers via `currentChunkIndex` on the return
  // value (state-backed below). Internal callers use the ref for
  // synchronous reads inside `tryAdvance`; external consumers use the
  // state for re-render-on-change semantics.
  const currentChunkIndexRef = useRef<number | null>(null);
  const [currentChunkIndex, setCurrentChunkIndex] = useState<number | null>(
    null,
  );
  // Helper: keep ref + state + cross-bubble store in sync. Always go
  // through this so we never forget to publish externally; the ref's
  // synchronous read inside `tryAdvance` keeps its existing semantics.
  //
  // The cross-bubble publish happens here too. When `next === null` we
  // clear only if this message owns the active slot — a stale
  // chunk-end firing for a message that was already preempted by the
  // coordinator must not wipe a peer's active state. When `next` is a
  // number, this message is now active; the coordinator has already
  // preempted any prior owner so a `set` is safe.
  const setCurrentChunkIndexBoth = useCallback(
    (next: number | null) => {
      currentChunkIndexRef.current = next;
      setCurrentChunkIndex(next);
      if (!opts.messageId) return;
      if (next === null) {
        publishActivePlayback(null);
      } else {
        publishActivePlayback({ messageId: opts.messageId, chunkIndex: next });
      }
    },
    [opts.messageId, publishActivePlayback],
  );
  // Identity-based freshness snapshot: capture the set of chunk IDs
  // present on this player's first non-undefined `chunks` value. Any
  // chunk whose `chunkId` is NOT in the snapshot was produced during
  // this mount → fresh, eligible for auto-play. Chunks that were in
  // the snapshot are historical (loaded from thread history) → must
  // not auto-play.
  //
  // Identity-based replaces the prior wall-clock `mountTimeRef` /
  // `chunk.createdAt > mountTime` approach. The wall-clock comparison
  // worked for the player because `chunk.createdAt` is client-side
  // (set at reservation time, after mount) so the direction was
  // correct, but the identity-based snapshot is still strictly better:
  // immune to multi-tab inconsistency, no false positives if a chunk
  // somehow gets a stale `createdAt`, and parallels the chunker's
  // freshness gate so both hooks reason about the same concept.
  const initialChunkIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (initialChunkIdsRef.current !== null) return;
    if (chunks === undefined) return;
    // Convex subscription returns `undefined` while loading, `[]` once
    // settled with no rows. Snapshot on the first settled tick — `[]`
    // is a valid empty snapshot meaning "no history; anything that
    // appears next is fresh".
    initialChunkIdsRef.current = new Set(chunks.map((c) => c.chunkId));
  }, [chunks]);
  // One-shot guard so each (messageId, mount) pair auto-plays at most once.
  const hasAutoStartedRef = useRef(false);

  // Mirrors `opts.isStreaming` into a ref so `tryAdvance` can branch on it
  // without taking a dependency on the latest prop value (which would churn
  // the callback identity and re-fire dependent effects on every token).
  const isStreamingRef = useRef(opts.isStreaming);
  useEffect(() => {
    isStreamingRef.current = opts.isStreaming;
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

  const stopRef = useRef<() => void>(() => {});

  const stop = useCallback(() => {
    activeRef.current = false;
    detachAudioListeners();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      // No `el.load()` here: `pause()` + `removeAttribute('src')` is
      // enough to release the buffer, and calling `load()` after
      // teardown can consume the iOS Safari user-activation token on
      // the singleton element so the NEXT message's first `play()`
      // rejects with NotAllowedError. The element is dropped from the
      // ref immediately below, so heap growth is bounded regardless.
      audioRef.current = null;
    }
    setCurrentChunkIndexBoth(null);
    coordinator.release(stopRef.current);
    setState('idle');
  }, [detachAudioListeners, coordinator, setCurrentChunkIndexBoth]);

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
          // Prefer the provider-owned audio element so the iOS Safari
          // activation token banked at toggle/send time transfers to
          // the same element that will actually play the chunks. The
          // per-provider element fixes the arena-split-view bug where
          // two providers shared one singleton and stomped each
          // other's `src` (round-5 finding #23). Falls back to a fresh
          // `new Audio()` in SSR / no-provider contexts (the indicator
          // never mounts outside a provider in practice, but the
          // fallback keeps unit-test environments alive).
          if (providerAudioElement) {
            audioRef.current = providerAudioElement;
          } else {
            const fallback = new Audio();
            configurePlaybackElement(fallback);
            audioRef.current = fallback;
          }
        }
        const el = audioRef.current;
        detachAudioListeners();
        el.src = buildTtsAudioUrl(chunk.chunkId);
        setCurrentChunkIndexBoth(chunk.index);
        const onEnded = () => {
          setCurrentChunkIndexBoth(null);
          nextIndexRef.current = chunk.index + 1;
          tryAdvanceRef.current();
        };
        const onError = () => {
          // Decode / fetch failure on a chunk the server marked ready.
          // Skip it (the chunk row carries no errorCode for this path
          // because the server side succeeded). Bump the failure counter
          // so we can surface a synthetic `AUDIO_DECODE` code via the
          // indicator when every ready chunk in this run has failed —
          // without it, a permanently broken audio response yields pure
          // silence with no actionable signal for the user.
          console.warn(
            '[tts.player] audio element decode error; skipping chunk',
            chunk.index,
          );
          decodeFailureCountRef.current += 1;
          detachAudioListeners();
          setCurrentChunkIndexBoth(null);
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
            setCurrentChunkIndexBoth(null);
            setState('blocked');
          } else if (err instanceof Error && err.name === 'AbortError') {
            // StrictMode double-mount + cleanup races produce AbortError
            // when a previous `play()` is interrupted by `pause()` /
            // `src` swap. Not a user-facing failure — the new attempt
            // takes over, no state change needed. Logged at debug so a
            // genuine AbortError outside the StrictMode / handoff path
            // would still leave a forensic trail (per CLAUDE.md
            // no-empty-catch).
            console.debug(
              '[tts.player] play() aborted by cleanup race (benign)',
              err,
            );
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
        setCurrentChunkIndexBoth(null);
        nextIndexRef.current = chunk.index + 1;
        return tryAdvanceRef.current();
      }
      // status === 'pending' — wait for the next subscription tick.
      return false;
    },
    [detachAudioListeners, providerAudioElement, setCurrentChunkIndexBoth],
  );

  const tryAdvance = useCallback((): boolean => {
    if (!activeRef.current) return false;
    const list = chunksRef.current;
    if (!list || list.length === 0) return false;
    const target = list.find((c) => c.index === nextIndexRef.current);
    if (!target) {
      const maxIndex = list[list.length - 1].index;
      // Only retire when we've run past the highest known index AND the
      // message is no longer streaming. While streaming, the chunker may
      // still emit `nextIndexRef.current` next; if we go idle here, the
      // subscription effect at line 248 short-circuits on `!activeRef`
      // and we never auto-resume — voice cuts out partway through any
      // fast-network reply where playback catches up to the chunker.
      if (nextIndexRef.current > maxIndex && !isStreamingRef.current) {
        activeRef.current = false;
        // Clear the cross-bubble active-playback so the paragraph
        // spotlight in the message content releases on natural
        // playback end (not just on explicit stop). Without this,
        // the last paragraph stays bright after audio finishes.
        setCurrentChunkIndexBoth(null);
        coordinator.release(stopRef.current);
        setState('idle');
      }
      return false;
    }
    return playChunk(target);
  }, [playChunk, coordinator, setCurrentChunkIndexBoth]);

  useEffect(() => {
    tryAdvanceRef.current = tryAdvance;
  }, [tryAdvance]);

  useEffect(() => {
    chunksRef.current = chunks ?? undefined;
    if (activeRef.current) {
      tryAdvance();
    }
  }, [chunks, tryAdvance]);

  // When streaming ends, re-run `tryAdvance` so a player parked at the
  // streaming "wait for next chunk" gate can retire cleanly. Without this,
  // a player that already passed the last index would stay in `'playing'`
  // until the next chunks update (which may never come).
  useEffect(() => {
    if (!opts.isStreaming && activeRef.current) {
      tryAdvance();
    }
  }, [opts.isStreaming, tryAdvance]);

  const play = useCallback(() => {
    // Re-prime on every play() invocation. `primeAudio` is idempotent,
    // and re-running it inside the click gesture refreshes the iOS
    // Safari user-activation token on the provider-owned audio
    // element — without this, the second message of a session would
    // frequently hit `NotAllowedError` because the prior `stop()` (now
    // load()-free, see above) had still effectively expired the
    // activation. Cheap when already-primed.
    primeAudio(providerAudioElement);
    // Await coordinator handoff so the outgoing player's media-element
    // teardown settles before this player reassigns `el.src`. Fire-and-
    // forget: the surrounding click / auto-play handler doesn't need
    // to await playback startup, only the claim handshake.
    void coordinator.claim(stopRef.current).then(() => {
      decodeFailureCountRef.current = 0;
      activeRef.current = true;
      nextIndexRef.current = 0;
      tryAdvance();
    });
  }, [coordinator, tryAdvance, providerAudioElement]);

  // Auto-play: fires once per (messageId, mount) only when a ready chunk
  // NOT present in the initial snapshot appears. Historical chunks (those
  // captured in `initialChunkIdsRef`) are loaded from thread history and
  // must not auto-replay.
  useEffect(() => {
    if (!opts.enabled) return;
    if (hasAutoStartedRef.current) return;
    if (activeRef.current) return;
    if (!chunks || chunks.length === 0) return;
    const initial = initialChunkIdsRef.current;
    // Snapshot not captured yet (first tick races the chunks
    // subscription). Don't auto-play this frame; the snapshot effect
    // will populate on the next render and this effect re-runs.
    if (initial === null) return;
    const playable = chunks.find(
      (c) => c.status === 'ready' && !initial.has(c.chunkId),
    );
    if (!playable) return;
    hasAutoStartedRef.current = true;
    play();
  }, [opts.enabled, chunks, play]);

  // Reset auto-play guard + initial-chunks snapshot on message change.
  // The snapshot is per-message: a new assistant bubble means a new
  // identity for "what was history" — re-snapshot so the fresh chunks
  // for the new message are classified correctly.
  useEffect(() => {
    hasAutoStartedRef.current = false;
    initialChunkIdsRef.current = null;
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

  // The announcer-publish effect lives further down in the file so it
  // can reference `errorCode` (computed after this section). Search for
  // `// Publish state transitions to the chat-level announcer`.

  const prevStateRef = useRef<VoicePlayerStateName>('idle');

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
  const chunkErrorCode = failed?.error
    ? failed.error.split(':')[0]?.trim() || undefined
    : undefined;

  // Synthetic `AUDIO_DECODE` surfaces when every server-ready chunk
  // failed on the client side (the `<audio>` element's `error` event
  // fired for each). Only published once the message is no longer
  // streaming AND at least one chunk failed; otherwise an in-flight
  // streaming message that happens to have a transient decode glitch
  // on one chunk would flash an error before the next chunk recovers.
  const readyChunkCount =
    chunks?.filter((c) => c.status === 'ready').length ?? 0;
  const allDecodeFailed =
    !opts.isStreaming &&
    readyChunkCount > 0 &&
    decodeFailureCountRef.current >= readyChunkCount;

  // Precedence: chunk-row failure (terminal, server already wrote it)
  // → pre-reservation error (chunker couldn't even create a row) →
  // synthetic AUDIO_DECODE (client-side playback failure on every
  // server-ready chunk).
  const errorCode =
    chunkErrorCode ??
    preReservationError ??
    (allDecodeFailed ? 'AUDIO_DECODE' : undefined);

  // Publish state transitions to the chat-level announcer so screen-
  // reader users hear playback changes. Skipping no-op (state === prev)
  // and the initial `idle → idle` mount means SR gets exactly one
  // announcement per real transition — never per chunk advance, never
  // per re-render. Routed AFTER `errorCode` is derived so the
  // announcer can speak the specific reason on transitions into
  // `'error'` instead of the generic "Voice output failed" (round-5
  // finding #25).
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (state === prev) return;
    if (state === 'playing') announce({ state: 'playing' });
    else if (state === 'blocked') announce({ state: 'blocked' });
    else if (state === 'error') announce({ state: 'error', errorCode });
    else if (state === 'idle' && prev === 'playing') {
      announce({ state: 'stopped' });
    }
  }, [state, errorCode, announce]);

  // Split out so the indicator can distinguish "synth in flight"
  // (`hasPendingChunk`) from "playable audio exists" (`hasReadyChunk`).
  // The old combined `hasAudio` caused a brief "idle Play" flash
  // between pending-row arrival and first ready chunk.
  const { hasReadyChunk, hasPendingChunk } = useMemo(() => {
    let ready = false;
    let pending = false;
    for (const c of chunks ?? []) {
      if (c.status === 'ready') ready = true;
      else if (c.status === 'pending') pending = true;
      if (ready && pending) break;
    }
    return { hasReadyChunk: ready, hasPendingChunk: pending };
  }, [chunks]);

  return {
    state,
    hasReadyChunk,
    hasPendingChunk,
    errorCode,
    currentChunkIndex,
    play,
    stop,
  };
}

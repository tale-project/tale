'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { usePrefersReducedMotion } from '../../../hooks/use-prefers-reduced-motion';
import type { FlowPlaybackSpeed, FlowPlaybackTimeline } from './types';

/** Under reduced motion, play steps from event to event this often. */
export const FLOW_PLAYBACK_STEP_MS = 600;

export interface FlowPlaybackClock {
  /** The moment shown. */
  t: number;
  /** Moves to a moment; on a live timeline, stops following its end. */
  setT: (t: number) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  speed: FlowPlaybackSpeed;
  setSpeed: (speed: FlowPlaybackSpeed) => void;
  /** A live timeline: `t` stays on its growing end. */
  following: boolean;
  /** Back to the live end. */
  follow: () => void;
}

/** The first event after `t`, else the end. */
export function nextFlowEvent(
  timeline: FlowPlaybackTimeline,
  t: number,
): number {
  return timeline.events.find((at) => at > t + 0.5) ?? timeline.duration;
}

/** The last event before `t`, else the start. */
export function previousFlowEvent(
  timeline: FlowPlaybackTimeline,
  t: number,
): number {
  return [...timeline.events].reverse().find((at) => at < t - 0.5) ?? 0;
}

/**
 * The clock a host drives a playback with. It opens on the end of the run
 * (the whole story); playing from the end starts over. While it plays, `t`
 * advances with the frames at `speed` and stops at the end. On a live
 * timeline it follows the growing end until the reader moves `t`, and
 * `follow()` goes back to it.
 *
 * Under reduced motion nothing sweeps: playing steps from event to event
 * every 600 ms, so the states change without anything gliding.
 */
export function usePlaybackClock({
  timeline,
  live = timeline.live === true,
}: {
  timeline: FlowPlaybackTimeline;
  live?: boolean;
}): FlowPlaybackClock {
  const reduced = usePrefersReducedMotion();
  const [t, setTState] = useState(timeline.duration);
  const [playing, setPlayingState] = useState(false);
  const [speed, setSpeed] = useState<FlowPlaybackSpeed>(1);
  const [following, setFollowing] = useState(live);

  const latest = useRef({ timeline, t, speed });
  latest.current = { timeline, t, speed };

  // A live timeline grows: a follower stays on its end.
  useEffect(() => {
    if (live && following) setTState(timeline.duration);
  }, [live, following, timeline.duration]);

  const setT = useCallback(
    (next: number) => {
      const clamped = Math.min(
        Math.max(0, next),
        latest.current.timeline.duration,
      );
      setTState(clamped);
      if (live) setFollowing(clamped >= latest.current.timeline.duration);
    },
    [live],
  );

  const setPlaying = useCallback((next: boolean) => {
    if (next && latest.current.t >= latest.current.timeline.duration)
      setTState(0);
    setPlayingState(next);
  }, []);

  const follow = useCallback(() => {
    setFollowing(true);
    setTState(latest.current.timeline.duration);
  }, []);

  useEffect(() => {
    if (!playing) return undefined;
    if (reduced) {
      const timer = setInterval(() => {
        const { timeline: current, t: now } = latest.current;
        const next = nextFlowEvent(current, now);
        setTState(next);
        if (next >= current.duration) setPlayingState(false);
      }, FLOW_PLAYBACK_STEP_MS);
      return () => clearInterval(timer);
    }
    let frame = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      const elapsed = last === null ? 0 : now - last;
      last = now;
      const { timeline: current, t: shown, speed: rate } = latest.current;
      const next = Math.min(current.duration, shown + elapsed * rate);
      latest.current = { ...latest.current, t: next };
      setTState(next);
      if (next >= current.duration) {
        setPlayingState(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, reduced]);

  return {
    t,
    setT,
    playing,
    setPlaying,
    speed,
    setSpeed,
    following,
    follow,
  };
}

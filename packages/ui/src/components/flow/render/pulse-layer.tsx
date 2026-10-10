'use client';

import { ViewportPortal } from '@xyflow/react';
import { memo, useLayoutEffect, useRef } from 'react';

import { FLOW_EDGE_CORNER_RADIUS } from '../edge-palette';
import { roundedOrthogonalPath, sampleRoute } from '../layout/geometry';
import type { FlowLayout, FlowPoint } from '../types';

/** One playback "second" of a pulse: its animation runs paused, and its
 *  `currentTime` is the travel's progress times this. */
export const FLOW_PULSE_DURATION = 1_000;

/** How far apart the pulse's keyframes sit along its route. */
const SAMPLE_STEP = 8;
/** Half the dot, so its centre rides the line. */
const DOT_HALF = 4;
/** Over how much of its route a dot fades in, and dissolves into the box
 *  it reaches: a fixed distance, so a dot on a short line does not blink
 *  out and one on a long line does not fade from far away. */
const FADE_PX = 16;
/** The most of a route the two fades may take, together under half. */
const FADE_MAX = 0.2;

/** The share of a route each fade takes. */
function fadeShare(points: readonly FlowPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1];
    const b = points[index];
    if (a && b) length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length > 0 ? Math.min(FADE_MAX, FADE_PX / length) : FADE_MAX;
}

/**
 * Keyframe points every 8 px along the route the canvas draws (rounded
 * corners included), read from an SVG path when the page can measure one,
 * else along the route's straight segments.
 */
function pulsePoints(
  points: readonly FlowPoint[],
): Array<FlowPoint & { offset: number }> {
  if (typeof document !== 'undefined') {
    try {
      const path = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'path',
      );
      path.setAttribute(
        'd',
        roundedOrthogonalPath(points, FLOW_EDGE_CORNER_RADIUS),
      );
      const total = path.getTotalLength();
      if (total > 0) {
        const out: Array<FlowPoint & { offset: number }> = [];
        for (let along = 0; along < total; along += SAMPLE_STEP) {
          const point = path.getPointAtLength(along);
          out.push({ x: point.x, y: point.y, offset: along / total });
        }
        const end = path.getPointAtLength(total);
        out.push({ x: end.x, y: end.y, offset: 1 });
        return out;
      }
    } catch (error) {
      console.warn(
        'Flow pulse could not measure its route; following its segments',
        error,
      );
    }
  }
  return sampleRoute(points, SAMPLE_STEP);
}

/**
 * A value on its way: an 8 px dot riding its line. The motion is a Web
 * Animation created paused — the host's time sets its `currentTime`, so
 * playing, scrubbing and stepping are the same thing, and a dot is exactly
 * where the travel's progress says. It fades in over its first 16 px and,
 * over its last 16 px, shrinks to half and fades into the box it reaches.
 */
const FlowPulse = memo(function FlowPulse({
  edgeId,
  points,
  progress,
}: {
  edgeId: string;
  points: readonly FlowPoint[];
  progress: number;
}) {
  const moveRef = useRef<HTMLSpanElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const animations = useRef<Animation[]>([]);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useLayoutEffect(() => {
    const move = moveRef.current;
    const dot = dotRef.current;
    if (move === null || dot === null || typeof move.animate !== 'function')
      return undefined;
    const samples = pulsePoints(points);
    const travel = move.animate(
      samples.map(({ x, y, offset }) => ({
        transform: `translate(${x - DOT_HALF}px, ${y - DOT_HALF}px)`,
        offset,
      })),
      { duration: FLOW_PULSE_DURATION, fill: 'both', easing: 'linear' },
    );
    const share = fadeShare(points);
    const fade = dot.animate(
      [
        { opacity: 0, transform: 'scale(1)', offset: 0 },
        { opacity: 1, transform: 'scale(1)', offset: share },
        { opacity: 1, transform: 'scale(1)', offset: 1 - share },
        { opacity: 0, transform: 'scale(0.5)', offset: 1 },
      ],
      { duration: FLOW_PULSE_DURATION, fill: 'both' },
    );
    travel.pause();
    fade.pause();
    animations.current = [travel, fade];
    for (const animation of animations.current)
      animation.currentTime = progressRef.current * FLOW_PULSE_DURATION;
    return () => {
      travel.cancel();
      fade.cancel();
      animations.current = [];
    };
  }, [points]);

  useLayoutEffect(() => {
    for (const animation of animations.current)
      animation.currentTime = progress * FLOW_PULSE_DURATION;
  }, [progress]);

  return (
    <span
      ref={moveRef}
      aria-hidden="true"
      data-flow-pulse={edgeId}
      className="pointer-events-none absolute top-0 left-0"
    >
      <span
        ref={dotRef}
        className="block size-2 rounded-full bg-[hsl(var(--info-foreground))] ring-4 ring-[hsl(var(--info-foreground)/0.25)]"
      />
    </span>
  );
});

/**
 * The values moving through a run at the moment shown: one dot per
 * active travel, drawn in the chart's own coordinates. Under reduced
 * motion there are none — the lines switch to travelled when a value
 * arrives, and the states tell the story.
 */
export function FlowPulseLayer({
  travelling,
  layout,
}: {
  travelling: ReadonlyArray<{
    edgeId: string;
    progress: number;
    item?: number;
  }>;
  layout: FlowLayout;
}) {
  if (travelling.length === 0) return null;
  // Two values can be on one line at once (items of a list, passes of a
  // repeat): each keeps its own dot.
  const seen = new Map<string, number>();
  return (
    <ViewportPortal>
      {travelling.map(({ edgeId, progress, item }) => {
        const route = layout.edges[edgeId];
        if (route === undefined) return null;
        const base = `${edgeId}:${item ?? ''}`;
        const nth = seen.get(base) ?? 0;
        seen.set(base, nth + 1);
        return (
          <FlowPulse
            key={`${base}:${nth}`}
            edgeId={edgeId}
            points={route.points}
            progress={progress}
          />
        );
      })}
    </ViewportPortal>
  );
}

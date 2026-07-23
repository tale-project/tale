// Shared builders for the unit tests. Imported only by `*.test.ts` files (never
// bundled), they keep recordings terse so each test states just what it varies.

import type { ElementTrack, GeometrySample, Rect, Recording } from './types';

/** Build a rect in edge order: top, right, bottom, left. */
export function rect(
  top: number,
  right: number,
  bottom: number,
  left: number,
): Rect {
  return { top, right, bottom, left };
}

export type SampleOpts = {
  t: number;
  frame: number;
  segment?: number;
  screen: Rect;
  /** Defaults to `screen` (no scroll) when omitted. */
  page?: Rect;
  opacity?: number;
  visible?: boolean;
  inViewport?: boolean;
  occluded?: boolean;
  paints?: boolean;
  pixelNoise?: number | null;
  colorKey?: number;
  outOfFlow?: boolean;
  canPin?: boolean;
};

/** A geometry sample with sensible "visible and painting" defaults. */
export function sample(o: SampleOpts): GeometrySample {
  return {
    t: o.t,
    frame: o.frame,
    segment: o.segment ?? 0,
    rectScreen: o.screen,
    rectPage: o.page ?? o.screen,
    opacity: o.opacity ?? 1,
    visible: o.visible ?? true,
    inViewport: o.inViewport ?? true,
    occluded: o.occluded ?? false,
    paints: o.paints ?? true,
    pixelNoise: o.pixelNoise ?? null,
    colorKey: o.colorKey ?? 0,
    ...(o.outOfFlow !== undefined ? { outOfFlow: o.outOfFlow } : {}),
    ...(o.canPin !== undefined ? { canPin: o.canPin } : {}),
  };
}

export type TrackOpts = {
  key: string;
  testid?: string | null;
  selector?: string;
  tag?: string;
  kind?: ElementTrack['kind'];
  ancestorKeys?: readonly string[];
  samples: readonly GeometrySample[];
  layoutProbe?: ElementTrack['layoutProbe'];
};

/** An element track; `layoutProbe`/`tag` are attached only when provided. */
export function track(o: TrackOpts): ElementTrack {
  const base: ElementTrack = {
    key: o.key,
    testid: o.testid ?? (o.kind === 'candidate' ? null : o.key),
    selector: o.selector ?? `#${o.key}`,
    kind: o.kind ?? 'tracked',
    ancestorKeys: o.ancestorKeys ?? [],
    samples: o.samples,
    ...(o.tag === undefined ? {} : { tag: o.tag }),
  };
  // exactOptionalPropertyTypes: omit the key rather than set it undefined.
  return o.layoutProbe ? { ...base, layoutProbe: o.layoutProbe } : base;
}

/** A recording with default threshold/budget and a single segment. */
export function recording(
  elements: readonly ElementTrack[],
  layoutShifts: Recording['layoutShifts'] = [],
): Recording {
  return {
    pixelThreshold: 1,
    frameBudgetMs: 1000 / 60,
    segments: [{ index: 0, url: 'https://example.test/', from: 0, to: 1000 }],
    elements,
    layoutShifts,
  };
}

/** Narrow `T | undefined` without the banned non-null assertion. */
export function must<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

/**
 * The workflow canvas's motion, in one place: the duration and ease tokens
 * of `globals.css` (a test holds the numbers to the stylesheet) and the
 * animation classes a live relayout puts on what enters, leaves and moves.
 *
 * A relayout plays in three beats: what leaves fades out (short), what
 * stays glides to its new place (medium), what joins fades in once the
 * glide is under way (standard, after short) and new lines last, once the
 * boxes are nearly there (standard, after 250 ms) — so no line is ever
 * drawn against a box still moving. Everything settles in 450 ms. Under
 * reduced motion none of it runs: the new picture is simply there.
 */

/** The `--duration-*` tokens, in milliseconds. */
export const FLOW_DURATION = {
  micro: 100,
  short: 150,
  standard: 200,
  medium: 300,
  long: 400,
} as const;

/** The `--ease-out-quint` token, for motion run from script. */
export const FLOW_EASE_OUT_QUINT = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** When new lines start fading in after a relayout. */
export const FLOW_EDGE_ENTER_DELAY = 250;

/** When a relayout's geometry has settled: the last line is in. */
export const FLOW_RELAYOUT_SETTLE =
  FLOW_EDGE_ENTER_DELAY + FLOW_DURATION.standard;

/**
 * A changed node's ring: it fades in over `short` while the box glides —
 * never switched on at full strength, which reads as a flash — holds while
 * the relayout settles and a moment after, so the eye finds it, then fades
 * out over `long`. Gone at 1.2 s.
 */
export const FLOW_RING_TOTAL = 1_200;

/** The move of a relayout, on React Flow's node wrapper (which positions
 *  each node with a `transform`). */
export const FLOW_MOVE_TRANSITION =
  'transform var(--duration-medium) var(--ease-out-quint)';

/** The animation classes of each part of a relayout. */
export const FLOW_MOTION_CLASS = {
  /** A node or condition that joins: grows in from the exit scale. */
  enter:
    'animate-[flow-enter_var(--duration-standard)_var(--ease-out-quint)_var(--duration-short)_backwards]',
  /** A node or condition that leaves: shrinks to the exit scale. */
  exit: 'animate-[flow-exit_var(--duration-short)_var(--ease-out-quint)_forwards]',
  /** A new or re-routed line, a resized frame: fades in last. */
  fadeIn:
    'animate-[fade-in_var(--duration-standard)_var(--ease-out-quint)_250ms_backwards]',
  /** A line that is gone or re-routed, a frame that changed size. */
  fadeOut:
    'animate-[flow-fade-out_var(--duration-short)_var(--ease-out-quint)_forwards]',
  /** A changed node's ring: fades in, holds, fades out (`flow-ring`). */
  ring: 'animate-[flow-ring_1200ms_var(--ease-default)_both]',
  /** A running node's top bar: a soft light gliding across its track,
   *  slow and eased, so a chart with several nodes running stays calm. */
  sweep: 'animate-[flow-running-sweep_1.6s_var(--ease-in-out)_infinite]',
} as const;

/** A strip whose words change while a run plays: a soft settle. */
export const FLOW_STRIP_SETTLE: {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
} = {
  keyframes: [{ opacity: 0.35 }, { opacity: 1 }],
  options: { duration: FLOW_DURATION.short, easing: FLOW_EASE_OUT_QUINT },
};

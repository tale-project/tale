/**
 * Box chrome the chart, its List view and its legend share, so the three
 * always draw a mark the same way.
 */

/**
 * The border of a box that may not run, or did not: dashed, in a colour
 * that keeps 3:1 against the card (`--flow-node-dashed`), so the dashes
 * still read at half zoom.
 */
export const FLOW_NODE_DASHED =
  'border-dashed border-[color:var(--flow-node-dashed)]';

/**
 * A box's frame when two versions are compared: 2 px in the change's
 * colour (`--diff-*`, 3:1 and more on the card in both themes). Every box
 * is border-box, so the wider frame never changes its size. A rename is a
 * change.
 */
export const FLOW_DIFF_FRAME = {
  added: 'border-2 border-diff-added',
  removed: 'border-2 border-diff-removed',
  changed: 'border-2 border-diff-changed',
  renamed: 'border-2 border-diff-changed',
} as const;

/** The surface of a removed box: faint stripes (`--diff-removed-hatch`,
 *  under 8 % alpha, so its words keep 4.5:1) that drop in forced colours. */
export const FLOW_DIFF_HATCH =
  'bg-[repeating-linear-gradient(135deg,var(--diff-removed-hatch)_0_6px,transparent_6px_12px)]';

/** A change's badge on a box fades in; reduced motion shows it at once. */
export const FLOW_DIFF_BADGE_MOTION =
  'animate-in fade-in duration-[var(--duration-short)] ease-[var(--ease-out-quint)] motion-reduce:animate-none';

/** The icon tile at the head of a box. Start and End take the accent pair
 *  (`accent-base` / `accent-fg`): the chart's two anchors, the same token in
 *  both themes. */
export const FLOW_ICON_TILE = {
  plain: 'bg-muted text-muted-foreground',
  terminal: 'bg-accent-base text-accent-fg',
} as const;

/**
 * A control on a canvas keeps a 44 px target under a coarse pointer: an
 * invisible layer grows it to 44 px each way it falls short, never shrinking
 * it. Every button in the canvas's corners wears it — a host's too, through
 * `@tale/ui/flow/flow-canvas` — and the corner cluster spaces its buttons so
 * no two targets overlap.
 */
export const FLOW_TOUCH_TARGET =
  "relative pointer-coarse:after:absolute pointer-coarse:after:inset-[min(0px,calc((100%-44px)/2))] pointer-coarse:after:content-['']";

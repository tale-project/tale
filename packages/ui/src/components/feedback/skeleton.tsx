import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { useSkeleton } from './skeleton-context';

/**
 * Solid pulsing fill for {@link SkeletonText} word shapes — there is no real
 * content behind a masked line (the text is an invisible zero-width glyph), so
 * a plain opacity pulse is fine here. Box/circle masks instead layer a static
 * opaque base under the pulse (see below) so the content never shows through.
 */
export const SKELETON_PULSE =
  'animate-pulse bg-muted motion-reduce:animate-none';

/**
 * The pulse layer for box/circle masks: a faint shimmer that fades over the
 * opaque base. Kept as a separate, *non*-opaque tint so the base underneath
 * always hides the content even at the trough of the animation.
 */
const SKELETON_SHIMMER =
  'absolute inset-0 animate-pulse bg-muted-foreground/10 motion-reduce:animate-none';

interface SkeletonWrapProps {
  /**
   * The REAL content to mask. Rendered untouched; the skeleton sizes itself to
   * this content, so there is never any sizing math at the call site.
   */
  children: ReactNode;
  /**
   * Make the mask fill its container's width (block, `w-full`). Use for
   * full-width fields/controls; omit for inline content that should hug.
   */
  fullWidth?: boolean;
}

/**
 * While loading, render the real content inside a `display: contents` wrapper
 * that carries `visibility: hidden`. `contents` generates no box (so layout is
 * identical to rendering `children` bare — the skeleton still sizes to the
 * content), while `visibility: hidden` inherits down to every leaf so nothing
 * can peek out from under the opaque mask, and masked controls drop out of the
 * focus/hit-test order. When not loading the content renders untouched.
 */
function MaskedContent({
  loading,
  children,
}: {
  loading: boolean;
  children: ReactNode;
}) {
  if (!loading) return children;
  return <span className="invisible contents">{children}</span>;
}

/**
 * The universal masking primitive — `<SkeletonBox>{value}</SkeletonBox>`.
 *
 * Renders the real value as-is. While loading (`useSkeleton()` is true, i.e.
 * inside a `<Skeletonize loading>`) a static opaque base covers it with a pulse
 * shimmer layered on top — the base never animates, so the content stays hidden
 * even at the trough of the pulse. The content itself is `visibility: hidden`
 * while masked (see {@link MaskedContent}), so the base only has to draw the
 * placeholder *shape* and hugs the content box exactly. (It used to overhang by
 * 2px to swallow anti-aliased glyph edges, but that predates the visibility
 * mask — and the overhang made adjacent masks bleed into each other in tight
 * `gap-1` stacks.) The base also intercepts pointer events so masked controls
 * aren't interactive. When *not* loading the wrapper is `display: contents`, so
 * it adds no box and can't tangle layout — wrap any dynamic value (text, a
 * number, a control) unconditionally and leave it in place.
 *
 * Deliberately has no `className`/`style`: the skeleton's size comes from the
 * content it wraps, never from call-site styling. Reach for `fullWidth` (or a
 * new semantic prop here) instead of one-off classes.
 *
 * Sizing gotcha: with `fullWidth` the mask fills the *wrapper*, not the hidden
 * placeholder — a narrower placeholder (`w-2/3`, `max-w-48`) inside a
 * `fullWidth` box still paints a full-width mask. Put the width on an element
 * AROUND the box (`<div className="w-2/3"><SkeletonBox fullWidth>…`) so the
 * mask is exactly that wide. Percentage widths can't live on the placeholder
 * in the non-`fullWidth` case either: the wrapper is shrink-to-fit, so a
 * `%`-wide child collapses to zero.
 *
 * Decorative (`aria-hidden`): the enclosing `<Skeletonize>` announces "Loading"
 * once for the whole region, so individual boxes must not re-announce.
 */
export function SkeletonBox({ children, fullWidth }: SkeletonWrapProps) {
  const loading = useSkeleton();
  return (
    <span
      aria-hidden={loading || undefined}
      className={
        loading
          ? cn(
              'relative isolate rounded-md',
              fullWidth ? 'block w-full' : 'inline-block',
            )
          : 'contents'
      }
    >
      <MaskedContent loading={loading}>{children}</MaskedContent>
      {loading && (
        <span className="bg-muted absolute inset-0 overflow-hidden rounded-[inherit]">
          <span className={SKELETON_SHIMMER} />
        </span>
      )}
    </span>
  );
}

/**
 * Circular variant — avatars, status dots, icon buttons. Wraps real round
 * content and masks it with a round overlay. Renders its own skeleton (it does
 * not delegate to {@link SkeletonBox}) so it stays free of call-site styling.
 */
export function SkeletonCircle({ children, fullWidth }: SkeletonWrapProps) {
  const loading = useSkeleton();
  return (
    <span
      aria-hidden={loading || undefined}
      className={
        loading
          ? cn(
              'relative isolate rounded-full',
              fullWidth ? 'block w-full' : 'inline-block',
            )
          : 'contents'
      }
    >
      <MaskedContent loading={loading}>{children}</MaskedContent>
      {loading && (
        <span className="bg-muted absolute inset-0 overflow-hidden rounded-full">
          <span className={SKELETON_SHIMMER} />
        </span>
      )}
    </span>
  );
}

/**
 * Deterministic pseudo-random in [0, 1) from an integer seed. Stable across
 * SSR and client renders so masked text never flickers or warns on hydration
 * (plain `Math.random()` would differ between the two passes).
 */
function seeded(n: number): number {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h ^= h >>> 15;
  return (h >>> 0) / 0x1_0000_0000;
}

/**
 * The pulse overlay for one masked line of text. Fills its (relative) parent
 * line and clips to a rounded shape, then lays out 5–10 "word" segments whose
 * widths are randomly distributed but sum to 100% — each floored at a realistic
 * minimum so no word collapses. A small trailing gap between segments reads as
 * word spacing.
 */
function SkeletonLineFill({ seed }: { seed: number }) {
  // Fewer words + tighter spacing so a line reads as nearly-full text. The old
  // 5–10 words each with a 0.4em gap and a 1.5rem floor left visibly short,
  // sparse lines — especially in narrow containers (table cells, small fields)
  // where the cumulative gaps and the min-width floor overflowed and clipped.
  const segments = 4 + Math.floor(seeded(seed) * 4); // 4..7
  const weights = Array.from(
    { length: segments },
    (_, j) => 0.5 + seeded(seed * 7 + j * 17 + 1) * 1.5,
  );
  const total = weights.reduce((sum, w) => sum + w, 0);

  return (
    <span className="absolute inset-0 flex items-center overflow-hidden rounded-md">
      {weights.map((weight, j) => {
        const pct = ((weight / total) * 100).toFixed(2);
        return (
          <span
            // eslint-disable-next-line react/no-array-index-key
            key={j}
            className="h-[0.7em] shrink-0 pr-[0.28em] last:pr-0"
            // max(min, w%): widths share 100% but never collapse below a
            // realistic word width; a small floor keeps narrow containers from
            // overflowing (which clipped trailing words and shortened the line).
            style={{ width: `max(0.75rem, ${pct}%)` }}
          >
            <span
              className={cn('block size-full rounded-md', SKELETON_PULSE)}
            />
          </span>
        );
      })}
    </span>
  );
}

interface SkeletonTextProps {
  /** Number of text lines to mask. */
  lines?: number;
  /** Width of the final line — tapered to read like wrapped prose. */
  lastLineWidth?: string;
  /** Seed offset so adjacent blocks don't render an identical pattern. */
  seed?: number;
}

/**
 * Masked multi-line text. Each line is a relatively-positioned `<span>` whose
 * height comes from a hidden zero-width glyph, so it matches the surrounding
 * text metrics automatically — place it where the real text would sit and it
 * inherits the right `font-size`/`line-height`. A word-shaped pulse overlay
 * sits on top, and the final line is shortened so the block reads like a
 * wrapped paragraph.
 *
 * Like the other primitives it takes no `className`: size and color come from
 * the surrounding text context. Decorative (`aria-hidden`); the enclosing
 * `<Skeletonize>` owns the single status announcement.
 */
export function SkeletonText({
  lines = 1,
  lastLineWidth = '62%',
  seed = 0,
}: SkeletonTextProps) {
  const count = Math.max(1, lines);

  return (
    <span aria-hidden="true" className="block">
      {Array.from({ length: count }, (_, i) => {
        const isLast = i === count - 1;
        return (
          <span
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            className="relative block"
            style={isLast && count > 1 ? { width: lastLineWidth } : undefined}
          >
            {/* Hidden glyph: gives the line its real text height. The wrapping
                span never shows it, but keep it un-selectable just in case. */}
            <span className="invisible select-none">{'\u200B'}</span>
            <SkeletonLineFill seed={seed * 131 + i * 9973 + 1} />
          </span>
        );
      })}
    </span>
  );
}

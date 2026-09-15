import { Slot } from '@radix-ui/react-slot';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { useSkeleton } from './skeleton-context';

/** Shared, reduced-motion-aware fill for decorative text placeholders. */
export const SKELETON_PULSE =
  'animate-pulse bg-muted motion-reduce:animate-none';

interface SkeletonWrapProps extends HTMLAttributes<HTMLElement> {
  /** The real content, kept mounted in both loading states. */
  children: ReactNode;
  /**
   * Mask the child element itself, preserving its layout, dimensions and
   * border radius. The single child must forward DOM props and its ref.
   * Use for controls and elements participating in flex/grid layouts.
   */
  asChild?: boolean;
  /** Fill the container for wrapped text; asChild uses the child's own width. */
  fullWidth?: boolean;
}

/**
 * Mask a value while the surrounding Skeletonize is loading. Scalar values
 * get a stable inline box (or a block with fullWidth). With asChild the real
 * element IS the mask: its flex sizing, baseline, padding and radius never
 * depend on loading. No conditional wrapper can remount an uncontrolled field.
 *
 * The mask's CSS hides text, descendants and native field decorations while
 * painting its existing border box. Inert removes masked controls from pointer
 * and keyboard interaction; Skeletonize owns the region's single announcement.
 */
const SkeletonMask = forwardRef<
  HTMLElement,
  SkeletonWrapProps & { shape: 'box' | 'circle' }
>(
  (
    { children, asChild = false, fullWidth, shape, className, ...props },
    ref,
  ) => {
    const loading = useSkeleton();
    const Comp = asChild ? Slot : 'span';
    return (
      <Comp
        {...props}
        ref={ref}
        aria-hidden={loading ? true : props['aria-hidden']}
        inert={loading ? true : props.inert}
        data-skeleton-mask={loading ? shape : undefined}
        // A visible external <label> can forward activation to an inert
        // input/button. Cancel it before native or Radix click handlers run.
        onClickCapture={
          loading
            ? (event) => {
                event.preventDefault();
                event.stopPropagation();
              }
            : props.onClickCapture
        }
        className={cn(
          !asChild && (shape === 'circle' ? 'rounded-full' : 'rounded-md'),
          !asChild && (fullWidth ? 'block w-full' : 'inline-block'),
          className,
        )}
      >
        {children}
      </Comp>
    );
  },
);
SkeletonMask.displayName = 'SkeletonMask';

export const SkeletonBox = forwardRef<HTMLElement, SkeletonWrapProps>(
  (props, ref) => <SkeletonMask {...props} shape="box" ref={ref} />,
);
SkeletonBox.displayName = 'SkeletonBox';

/** Round mask for avatars and status dots; use asChild on their real surface. */
export const SkeletonCircle = forwardRef<HTMLElement, SkeletonWrapProps>(
  (props, ref) => <SkeletonMask {...props} shape="circle" ref={ref} />,
);
SkeletonCircle.displayName = 'SkeletonCircle';

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
 * It takes no `className`: size and color come from the surrounding text
 * context. Decorative (`aria-hidden`); the enclosing
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

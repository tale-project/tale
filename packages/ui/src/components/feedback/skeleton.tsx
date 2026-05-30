import { cva, type VariantProps } from 'class-variance-authority';
import type { CSSProperties, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/** Shared pulse appearance — reused by Skeleton, SkeletonBox, SkeletonText. */
export const SKELETON_PULSE =
  'animate-pulse bg-muted motion-reduce:animate-none';

const skeletonVariants = cva(SKELETON_PULSE, {
  variants: {
    size: {
      xs: 'size-4',
      sm: 'size-5',
      md: 'size-8',
      lg: 'size-9',
      xl: 'size-10',
    },
    shape: {
      default: 'rounded-md',
      circle: 'rounded-full',
    },
  },
  defaultVariants: {
    shape: 'default',
  },
});

interface SkeletonProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof skeletonVariants> {
  /** Accessible label for screen readers */
  label?: string;
}

export function Skeleton({
  className,
  size,
  shape,
  label = 'Loading content',
  ...props
}: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn(skeletonVariants({ size, shape }), className)}
      {...props}
    >
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * A masked placeholder. Two modes:
 *
 * 1. **Wrapping mode** (`children` given) — renders the real component
 *    invisibly to set the exact footprint, then paints a pulse overlay on top.
 *    This is the universal masking primitive: a control's wrapper renders
 *    `<SkeletonBox><FooBase …/></SkeletonBox>` while loading, so the skeleton is
 *    the SAME size as the live control with zero sizing math — and can't drift.
 *
 * 2. **Sized mode** (no children) — a plain pulse block sized by the caller via
 *    `className`/`style` (e.g. `h-10 w-full`), for placeholder rows/cells.
 *
 * Decorative (`aria-hidden`): the enclosing `<Skeletonize>` announces "Loading"
 * once for the whole region, so individual boxes must not re-announce.
 */
export function SkeletonBox({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  if (children != null) {
    return (
      <div aria-hidden="true" className={cn('relative isolate', className)}>
        {/* Real content, hidden but still laid out — sets the exact size. */}
        <div className="invisible">{children}</div>
        {/* Pulse overlay covering the footprint. */}
        <div
          className={cn(
            'pointer-events-none absolute inset-0 rounded-md',
            SKELETON_PULSE,
          )}
        />
      </div>
    );
  }
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn('block rounded-md', SKELETON_PULSE, className)}
    />
  );
}

/**
 * Masked text — `lines` pulse bars at the surrounding line-height (use
 * `leading-*`/`text-*` on `className` to match the real text's metrics so the
 * block occupies the same height). The last line is shortened when `lines > 1`
 * to read like wrapped prose. Decorative (`aria-hidden`); the enclosing
 * `<Skeletonize>` owns the single status announcement.
 */
export function SkeletonText({
  lines = 1,
  width = '100%',
  lastLineWidth = '60%',
  className,
}: {
  lines?: number;
  /** Width of the (single line, or every line but the last). */
  width?: string;
  /** Width of the final line when `lines > 1`. */
  lastLineWidth?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('flex flex-col justify-center', className)}
    >
      {Array.from({ length: Math.max(1, lines) }).map((_, i) => {
        const isLast = i === lines - 1 && lines > 1;
        return (
          <span
            key={i}
            className={cn(
              'my-[0.28em] block h-[0.72em] rounded-sm',
              SKELETON_PULSE,
            )}
            style={{ width: isLast ? lastLineWidth : width }}
          />
        );
      })}
    </span>
  );
}

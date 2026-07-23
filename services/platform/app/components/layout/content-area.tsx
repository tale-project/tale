'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * Applied LAST in `cn()` so call-site `py-*` / `pb-*` cannot drop dock
 * clearance (agent tabs pass `className="… py-4"` which would otherwise
 * replace the variant bottom padding and hide `--mobile-floating-actions-pad`).
 *
 * Base size comes from `--content-area-pb` set per variant.
 */
const FLOATING_DOCK_END_PAD =
  'pb-[calc(var(--content-area-pb)+var(--mobile-floating-actions-pad,0px))]';

const contentAreaVariants = cva(
  'flex min-w-0 w-full flex-col [--content-area-pb:1.5rem]',
  {
    variants: {
      variant: {
        page: 'px-4 pt-6 [--content-area-pb:1.5rem]',
        narrow: 'mx-auto max-w-[544px] px-4 pt-4 [--content-area-pb:1rem]',
        panel: 'px-6 pt-4 [--content-area-pb:1rem]',
      },
      gap: {
        3: 'gap-3',
        4: 'gap-4',
        5: 'gap-5',
        6: 'gap-6',
        8: 'gap-8',
      },
    },
    defaultVariants: {
      variant: 'page',
      gap: 6,
    },
  },
);

interface ContentAreaProps
  extends
    HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof contentAreaVariants> {}

export const ContentArea = forwardRef<HTMLDivElement, ContentAreaProps>(
  ({ variant, gap, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        contentAreaVariants({ variant, gap }),
        className,
        FLOATING_DOCK_END_PAD,
      )}
      {...props}
    />
  ),
);
ContentArea.displayName = 'ContentArea';

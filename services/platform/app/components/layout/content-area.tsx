'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

const contentAreaVariants = cva('flex w-full flex-col', {
  variants: {
    variant: {
      page: 'px-4 py-6',
      narrow: 'mx-auto max-w-[544px] px-4 py-4',
      panel: 'px-6 py-4',
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
});

interface ContentAreaProps
  extends
    HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof contentAreaVariants> {}

export const ContentArea = forwardRef<HTMLDivElement, ContentAreaProps>(
  ({ variant, gap, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(contentAreaVariants({ variant, gap }), className)}
      {...props}
    />
  ),
);
ContentArea.displayName = 'ContentArea';

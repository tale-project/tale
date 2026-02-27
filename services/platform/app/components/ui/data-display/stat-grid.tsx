'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { memo, type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

import { StatItem } from './stat-item';

const statGridVariants = cva('grid gap-x-4 gap-y-3', {
  variants: {
    cols: {
      1: 'grid-cols-1',
      2: 'grid-cols-2',
      3: 'grid-cols-3',
      4: 'grid-cols-4',
    },
  },
  defaultVariants: {
    cols: 2,
  },
});

export interface StatGridItem {
  label: string;
  value: ReactNode;
  colSpan?: 1 | 2;
}

interface StatGridProps extends VariantProps<typeof statGridVariants> {
  items: StatGridItem[];
  className?: string;
}

export const StatGrid = memo(function StatGrid({
  items,
  cols,
  className,
}: StatGridProps) {
  return (
    <dl className={cn(statGridVariants({ cols }), className)}>
      {items.map((item) => (
        <StatItem key={item.label} label={item.label} colSpan={item.colSpan}>
          {item.value}
        </StatItem>
      ))}
    </dl>
  );
});

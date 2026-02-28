'use client';

import * as React from 'react';

import { cn } from '@/lib/utils/cn';

import { Tooltip } from '../overlays/tooltip';

interface ProgressBarProps {
  value: number;
  max: number;
  label: string;
  tooltipContent: React.ReactNode;
  className?: string;
  indicatorClassName?: string;
}

export function ProgressBar({
  value,
  max,
  label,
  tooltipContent,
  className,
  indicatorClassName,
}: ProgressBarProps) {
  const percentage = max > 0 ? Math.round((value / max) * 100) : 0;
  const clampedPercentage = Math.min(percentage, 100);
  const barPercentage = Math.min(
    Math.max(max > 0 ? (value / max) * 100 : 0, 0),
    100,
  );

  return (
    <Tooltip content={tooltipContent}>
      <div
        className={cn('flex items-center gap-2', className)}
        role="group"
        aria-label={label}
      >
        <div
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-label={label}
          className="bg-muted relative h-1.5 w-full min-w-8 overflow-hidden rounded-full"
        >
          <div
            className={cn(
              'h-full w-full flex-1 bg-primary transition-all duration-300 ease-in-out',
              clampedPercentage === 100 && 'bg-green-500',
              indicatorClassName,
            )}
            style={{ transform: `translateX(-${100 - barPercentage}%)` }}
            aria-hidden="true"
          />
        </div>
        <span className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">
          {clampedPercentage}&#8239;%
        </span>
      </div>
    </Tooltip>
  );
}

'use client';

import * as React from 'react';

import { cn } from '../../lib/cn';
import {
  TooltipContent,
  TooltipRoot,
  TooltipTrigger,
} from '../overlays/tooltip';

interface ProgressBarProps {
  value: number;
  max: number;
  label: string;
  tooltipContent: React.ReactNode;
  className?: string;
  indicatorClassName?: string;
  /**
   * What to print beside the bar. Left out, it is the percentage; `null`
   * prints nothing, for a caller whose own figure sits outside the bar and
   * has to line up with something else.
   */
  valueText?: React.ReactNode;
}

export function ProgressBar({
  value,
  max,
  label,
  tooltipContent,
  className,
  indicatorClassName,
  valueText,
}: ProgressBarProps) {
  const percentage = max > 0 ? Math.round((value / max) * 100) : 0;
  const clampedPercentage = Math.min(percentage, 100);
  const barPercentage = Math.min(
    Math.max(max > 0 ? (value / max) * 100 : 0, 0),
    100,
  );

  const body = (
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
            'bg-primary h-full w-full flex-1 transition-transform duration-[var(--duration-medium)] ease-out motion-reduce:transition-none',
            clampedPercentage === 100 && 'bg-green-500',
            indicatorClassName,
          )}
          style={{ transform: `translateX(-${100 - barPercentage}%)` }}
          aria-hidden="true"
        />
      </div>
      {valueText === null ? null : (
        <span className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">
          {valueText === undefined ? (
            <>{clampedPercentage}&#8239;%</>
          ) : (
            valueText
          )}
        </span>
      )}
    </div>
  );

  if (!tooltipContent) return body;

  return (
    <TooltipRoot>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent>{tooltipContent}</TooltipContent>
    </TooltipRoot>
  );
}

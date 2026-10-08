'use client';

import { ChevronRightIcon } from 'lucide-react';
import {
  forwardRef,
  useState,
  type DetailsHTMLAttributes,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';

interface CollapsibleDetailsProps extends Omit<
  DetailsHTMLAttributes<HTMLDetailsElement>,
  'children'
> {
  summary: ReactNode;
  children: ReactNode;
  variant?: 'default' | 'compact';
  /**
   * Start open, then leave it to the reader: the uncontrolled twin of `open`.
   * A native `<details>` has no such attribute, so it is applied once, when
   * the element mounts.
   */
  defaultOpen?: boolean;
  /**
   * The summary's tab index — `-1` takes the toggle out of the tab order
   * while a composite widget (a roving list row) owns the one tab stop.
   * Omitted, the summary keeps its native focusability.
   */
  summaryTabIndex?: number;
}

export const CollapsibleDetails = forwardRef<
  HTMLDetailsElement,
  CollapsibleDetailsProps
>(
  (
    {
      summary,
      children,
      variant = 'default',
      className,
      defaultOpen = false,
      summaryTabIndex,
      open,
      ...props
    },
    ref,
  ) => {
    // Captured at mount. React writes `open` only when the prop changes, so a
    // constant `true` opens the element once and the reader's toggles stand.
    const [openAtMount] = useState(defaultOpen);
    return (
      <details
        ref={ref}
        className={cn('group', className)}
        open={open ?? (openAtMount || undefined)}
        {...props}
      >
        <summary
          tabIndex={summaryTabIndex}
          className={cn(
            // `items-start` keeps the chevron on the first line of a multi-line
            // summary (title + meta). `items-center` parked it mid-block.
            'flex min-w-0 cursor-pointer items-start gap-1 font-medium select-none',
            variant === 'default' ? 'text-sm' : 'text-muted-foreground text-xs',
          )}
        >
          <ChevronRightIcon
            className="mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-90"
            aria-hidden
          />
          {summary}
        </summary>
        {children}
      </details>
    );
  },
);
CollapsibleDetails.displayName = 'CollapsibleDetails';

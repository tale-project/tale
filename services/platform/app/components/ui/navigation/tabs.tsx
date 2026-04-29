'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cva } from 'class-variance-authority';
import { type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

export interface TabItem {
  value: string;
  label: ReactNode;
  content?: ReactNode;
  disabled?: boolean;
  /** Accessible name for triggers with icon-only labels. */
  ariaLabel?: string;
}

interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  listClassName?: string;
  triggerClassName?: string;
  /** Visual style variant */
  variant?: 'pill' | 'underline';
  /** Optional actions rendered to the right of the tab list */
  actions?: ReactNode;
}

const listVariants = cva(
  'scrollbar-hide inline-flex items-center overflow-x-auto text-muted-foreground',
  {
    variants: {
      variant: {
        pill: 'bg-muted rounded-lg p-1',
        underline: 'border-b border-border gap-4',
      },
    },
    defaultVariants: { variant: 'pill' },
  },
);

const triggerVariants = cva(
  'ring-offset-background focus-visible:ring-ring inline-flex items-center justify-center text-sm font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        pill: 'rounded-md px-3 py-1 transition-all data-[state=active]:bg-tab data-[state=active]:text-foreground data-[state=active]:shadow-sm',
        underline:
          'relative border-b-2 border-transparent px-1 pb-2 transition-colors data-[state=active]:border-primary data-[state=active]:text-foreground',
      },
    },
    defaultVariants: { variant: 'pill' },
  },
);

export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  className,
  listClassName,
  triggerClassName,
  variant = 'pill',
  actions,
}: TabsProps) {
  const hasContent = items.some((item) => item.content !== undefined);

  return (
    <TabsPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      className={className}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <TabsPrimitive.List
          className={cn(listVariants({ variant }), listClassName)}
        >
          {items.map((item) => (
            <TabsPrimitive.Trigger
              key={item.value}
              value={item.value}
              disabled={item.disabled}
              aria-label={item.ariaLabel}
              className={cn(triggerVariants({ variant }), triggerClassName)}
            >
              {item.label}
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {hasContent &&
        items.map(
          (item) =>
            item.content !== undefined && (
              <TabsPrimitive.Content
                key={item.value}
                value={item.value}
                className="ring-offset-background focus-visible:ring-ring mt-5 flex min-h-0 flex-1 flex-col focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                {item.content}
              </TabsPrimitive.Content>
            ),
        )}
    </TabsPrimitive.Root>
  );
}

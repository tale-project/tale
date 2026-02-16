'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

export interface TabItem {
  value: string;
  label: ReactNode;
  content?: ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  listClassName?: string;
}

export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  className,
  listClassName,
}: TabsProps) {
  return (
    <TabsPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      className={className}
    >
      <TabsPrimitive.List
        className={cn(
          'scrollbar-hide inline-flex items-center overflow-x-auto bg-muted p-1 text-muted-foreground rounded-lg',
          listClassName,
        )}
      >
        {items.map((item) => (
          <TabsPrimitive.Trigger
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            className="ring-offset-background focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:shadow-sm"
          >
            {item.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map(
        (item) =>
          item.content && (
            <TabsPrimitive.Content
              key={item.value}
              value={item.value}
              className="ring-offset-background focus-visible:ring-ring mt-2 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              {item.content}
            </TabsPrimitive.Content>
          ),
      )}
    </TabsPrimitive.Root>
  );
}

'use client';

/**
 * The card frame every connected block renders inside — a titled section (icon +
 * title + optional description + a right-aligned action slot) over a card
 * container. This is the structure the flat-tables page was missing; applying it
 * uniformly turns the view from a data dump into a product surface.
 */
import { Text } from '@tale/ui/text';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

export function Section({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'bg-card text-card-foreground rounded-lg border shadow-sm',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && (
            <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
              <Icon className="size-4" />
            </div>
          )}
          <div className="min-w-0">
            {title && (
              <Text as="span" className="font-semibold">
                {title}
              </Text>
            )}
            {description && (
              <Text variant="muted" className="block text-sm">
                {description}
              </Text>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

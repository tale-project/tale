'use client';

import { Heading } from '@tale/ui/heading';
import { Text } from '@tale/ui/text';
import { type ComponentType, type ReactNode } from 'react';

import { cn } from '../../lib/cn';

interface EmptyStateProps {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  /** Plain text or rich content (links, doc CTAs). Rendered in a `<div>`. */
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /**
   * Heading level for the title (1-6). Defaults to `2` so an empty state that
   * sits directly under a page `h1` (the common case — e.g. a list view's
   * empty body) does not skip from `h1` to `h3`. Pass an explicit level when
   * the empty state nests under a deeper section heading.
   */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  headingLevel = 2,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center px-4 py-12 text-center',
        className,
      )}
    >
      {Icon && (
        <Icon className="text-muted-foreground mb-4 size-5" aria-hidden />
      )}
      <Heading level={headingLevel} size="sm">
        {title}
      </Heading>
      {description && (
        // `as="div"` (not the default `<p>`): descriptions may carry rich block
        // content (links, doc CTAs), and a `<div>` inside a `<p>` is invalid.
        <Text as="div" variant="muted" className="mt-1 max-w-80">
          {description}
        </Text>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

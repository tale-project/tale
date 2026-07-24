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
   * Heading level for the title (1-6). Defaults to `3` — most empty states sit
   * inside a section (under an `h2`) or a dialog, where `h3` keeps the heading
   * order non-skipping. Pass an explicit level for other contexts: an empty
   * state rendered directly under a page `h1` (with no intervening section
   * heading) should use `2` so the outline doesn't skip `h1`→`h3`.
   */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  headingLevel = 3,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center px-4 py-12 text-center',
        className,
      )}
    >
      {Icon && (
        // 24px matches the platform empty-state spec (Conversations, Documents
        // search, etc.). size-5 (20px) read as a muted ornament next to the
        // title once these states are vertically centered in a full pane.
        <Icon className="text-muted-foreground mb-4 size-6" aria-hidden />
      )}
      <Heading level={headingLevel} size="sm">
        {title}
      </Heading>
      {description && (
        // `as="div"` (not the default `<p>`): descriptions may carry rich block
        // content (links, doc CTAs), and a `<div>` inside a `<p>` is invalid.
        // `min-h-10` reserves two text-sm lines (2 × 1.25rem) so one-line and
        // two-line descriptions produce equal-height empty states.
        <Text as="div" variant="muted" className="mt-1 min-h-10 max-w-80">
          {description}
        </Text>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

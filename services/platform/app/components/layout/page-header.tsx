'use client';

import { Description } from '@tale/ui/description';
import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Page title. Rendered at `text-lg`/semibold regardless of heading level. */
  title?: ReactNode;
  /** One-sentence description shown directly below the title. */
  description?: ReactNode;
  /** Optional right-aligned action(s) (e.g. an export button). Static — this
   *  header does not stick; long forms scroll it away with the content. */
  action?: ReactNode;
  /** Heading level for correct document outline. Defaults to `h1` (a top-level
   *  page). Sub-pages that already have a higher-level page title elsewhere
   *  (e.g. an agent's name in the tab-bar) pass `as="h2"`. The VISUAL style is
   *  identical at every level — only the semantics change. */
  as?: 'h1' | 'h2' | 'h3';
}

/**
 * The ONE page title/description treatment for top-level pages. Title is
 * `text-lg` semibold; description is `text-sm` muted; a 4px gap separates
 * them. Static by design (the user's chosen behavior) — it scrolls with the
 * content rather than pinning to the top.
 *
 * Settings pages and agent tabs carry NO page title (their rail/tab strip
 * already names the page) — they use section headers (`SettingsSection` /
 * `SectionHeader`) instead.
 */
export function PageHeader({
  title,
  description,
  action,
  as: Tag = 'h1',
  className,
  ...props
}: PageHeaderProps) {
  if (title == null && description == null && action == null) return null;
  return (
    <header
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {title != null && (
          <Tag className="text-foreground text-lg leading-tight font-semibold">
            {title}
          </Tag>
        )}
        {description != null && (
          <Description className="text-muted-foreground text-sm">
            {description}
          </Description>
        )}
      </div>
      {action && (
        <div className="flex shrink-0 items-center justify-end">{action}</div>
      )}
    </header>
  );
}

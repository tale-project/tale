'use client';

import { Description } from '@tale/ui/description';
import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface SettingsPageProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'title'
> {
  /** Page title (h1). */
  title: ReactNode;
  /** One-sentence description shown directly below the title. */
  description?: ReactNode;
  /** Optional right-aligned action(s) in the page header (e.g. export). */
  headerAction?: ReactNode;
  /** Section content — `<SettingsSection>` children separated by 32px gap. */
  children?: ReactNode;
}

/**
 * Every settings page top-level wrapper. Provides the consistent title block
 * + outer stack between sections (gap-8 = 32px) so the visual rhythm is the
 * same on every page in the settings area.
 */
export function SettingsPage({
  title,
  description,
  headerAction,
  children,
  className,
  ...props
}: SettingsPageProps) {
  return (
    <div className={cn('flex w-full flex-col gap-8', className)} {...props}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-foreground text-lg leading-tight font-semibold">
            {title}
          </h1>
          {description && (
            <Description className="text-muted-foreground text-sm">
              {description}
            </Description>
          )}
        </div>
        {headerAction && <div className="shrink-0">{headerAction}</div>}
      </header>
      {children && <div className="flex flex-col gap-8">{children}</div>}
    </div>
  );
}

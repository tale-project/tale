import { cn } from '@tale/ui/cn';
import type { ReactNode } from 'react';

import { LanguageSwitcher } from './language-switcher';
import { SiteContainer } from './site-container';
import { ThemeSwitcher } from './theme-switcher';

export interface FooterColumn {
  heading: string;
  /**
   * Each link is rendered as-is. Callers wrap their preferred link
   * component (LocalizedLink, anchor, TanStack Link) and pass it as a
   * ReactNode so footer styling stays consistent without baking in
   * routing assumptions.
   */
  links: ReactNode[];
}

interface SiteFooterProps {
  /** Logo + home link slot. */
  logo: ReactNode;
  /** Optional `<address>` or any structured contact info. */
  address?: ReactNode;
  /** Up to three columns of links shown to the right of the logo. */
  columns?: FooterColumn[];
  /** Lines rendered in the bottom-bar copyright slot. */
  copyrightLines: string[];
  /**
   * Trailing content in the bottom bar (typically GitHub icon link, etc.).
   * The language and theme switchers are rendered automatically.
   */
  bottomTrailing?: ReactNode;
  /**
   * If provided, renders an `llms.txt` link in the bottom bar so LLM
   * tooling can pick up the site's plain-text index.
   */
  llmsTxtUrl?: string;
  /** Localized label for the `llms.txt` link. */
  llmsTxtLabel?: string;
  /**
   * Override the inner content-width container. Defaults to the marketing
   * SiteContainer frame; docs pages pass a custom class to align with
   * their wider content layout.
   */
  containerClassName?: string;
}

/**
 * Marketing/docs footer shell shared between `services/web` and
 * `services/docs`. Owns the visual structure (logo column + link
 * columns + bottom bar) and ships the language and theme switchers in
 * the bottom bar; callers supply link components for each column so the
 * footer stays routing-agnostic.
 */
export function SiteFooter({
  logo,
  address,
  columns = [],
  copyrightLines,
  bottomTrailing,
  llmsTxtUrl,
  llmsTxtLabel = 'llms.txt',
  containerClassName,
}: SiteFooterProps) {
  const columnCount = columns.length;
  const gridCols =
    columnCount === 0
      ? 'grid-cols-1'
      : columnCount === 1
        ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_minmax(0,1fr)]'
        : columnCount === 2
          ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_repeat(2,minmax(0,1fr))]'
          : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_repeat(3,minmax(0,1fr))]';

  return (
    <footer className="border-border-base bg-bg-base border-t print:hidden">
      <SiteContainer className={containerClassName}>
        <div className={cn('grid gap-12 py-16', gridCols)}>
          <div className="text-fg-muted flex flex-col gap-4 text-sm sm:col-span-2 lg:col-span-1">
            {logo}
            {address}
          </div>

          {columns.map((col) => (
            <nav
              key={col.heading}
              aria-label={col.heading}
              className="flex flex-col gap-3"
            >
              <h3 className="text-fg-base text-sm font-semibold">
                {col.heading}
              </h3>
              <ul role="list" className="flex flex-col gap-2">
                {col.links.map((link, i) => (
                  // oxlint-disable-next-line react/no-array-index-key -- link order is stable
                  <li key={i}>{link}</li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="border-border-base flex flex-col gap-4 border-t py-6 sm:flex-row sm:items-center sm:justify-between">
          <div
            className="text-fg-muted text-sm"
            style={{ letterSpacing: '-0.084px', lineHeight: 1.4286 }}
          >
            {copyrightLines.map((line, i) => (
              // oxlint-disable-next-line react/no-array-index-key -- copyright line order is stable
              <p key={i}>{line}</p>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {llmsTxtUrl ? (
              <a
                href={llmsTxtUrl}
                className="text-fg-muted hover:text-fg-base focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base rounded-sm px-2 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                {llmsTxtLabel}
              </a>
            ) : null}
            <LanguageSwitcher />
            <ThemeSwitcher />
            {bottomTrailing}
          </div>
        </div>
      </SiteContainer>
    </footer>
  );
}

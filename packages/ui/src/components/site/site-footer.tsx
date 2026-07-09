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
  /**
   * Optional free-form body under the links (e.g. a company address).
   * Use when the column is not only a link list.
   */
  body?: ReactNode;
  /** Optional class on the column `<nav>` (e.g. grid placement). */
  className?: string;
}

interface SiteFooterProps {
  /** Logo + home link slot. Shown above the link grid when columns exist. */
  logo?: ReactNode;
  /**
   * Optional `<address>` or structured contact info. Rendered in the
   * bottom bar beneath the link columns when not placed in a column
   * via `FooterColumn.body`.
   */
  address?: ReactNode;
  /** Optional slot beside the logo (e.g. GitHub). */
  brandTrailing?: ReactNode;
  /** Link columns. When empty, the footer collapses to a single bottom bar. */
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
   * Optional companion to `llmsTxtUrl` for sites that also publish a
   * full-content `llms-full.txt`. Rendered next to the `llms.txt` link
   * with identical styling.
   */
  llmsFullTxtUrl?: string;
  /** Localized label for the `llms-full.txt` link. */
  llmsFullTxtLabel?: string;
  /**
   * Override the inner content-width container. Defaults to the marketing
   * SiteContainer frame; docs pages pass a custom class to align with
   * their wider content layout.
   */
  containerClassName?: string;
  /** Visual variant for the embedded theme switcher. Marketing uses
   *  `'segmented'` to render the inline pill control; docs keeps the
   *  default dropdown menu. */
  themeSwitcherVariant?: 'menu' | 'segmented';
  /** Forwards to the embedded language switcher. Marketing passes
   *  `false` to hide the trigger flag per design; docs leaves it on. */
  languageSwitcherShowFlag?: boolean;
}

/**
 * Marketing/docs footer shell shared between `services/web` and
 * `services/docs`. Owns the visual structure (logo row + link columns +
 * bottom bar with address) and ships the language and theme switchers;
 * callers supply link components so the footer stays routing-agnostic.
 */
export function SiteFooter({
  logo,
  address,
  brandTrailing,
  columns = [],
  copyrightLines,
  bottomTrailing,
  llmsTxtUrl,
  llmsTxtLabel = 'llms.txt',
  llmsFullTxtUrl,
  llmsFullTxtLabel = 'llms-full.txt',
  containerClassName,
  themeSwitcherVariant,
  languageSwitcherShowFlag,
}: SiteFooterProps) {
  const columnCount = columns.length;
  const compact = columnCount === 0;

  const llmLinkClass =
    'text-fg-muted hover:text-fg-base focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base rounded-sm px-2 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none';
  const switcherRow = (
    <div className="flex flex-wrap items-center gap-2">
      {llmsTxtUrl ? (
        <a href={llmsTxtUrl} className={llmLinkClass}>
          {llmsTxtLabel}
        </a>
      ) : null}
      {llmsFullTxtUrl ? (
        <a href={llmsFullTxtUrl} className={llmLinkClass}>
          {llmsFullTxtLabel}
        </a>
      ) : null}
      <LanguageSwitcher showFlag={languageSwitcherShowFlag} />
      <ThemeSwitcher variant={themeSwitcherVariant} />
      {bottomTrailing}
    </div>
  );

  // 2-up on mobile keeps the footer short; expand toward the column count
  // on larger screens (cap at 4 so Legal doesn't squeeze).
  const linkGridClass =
    columnCount <= 2
      ? 'grid-cols-2'
      : columnCount === 3
        ? 'grid-cols-2 sm:grid-cols-3'
        : 'grid-cols-2 sm:grid-cols-4';

  return (
    <footer className="border-border-base bg-bg-base dark:bg-bg-elevated border-t print:hidden">
      {compact ? (
        <SiteContainer className={containerClassName}>
          <div className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:py-6">
            <div
              className="text-fg-muted text-sm"
              style={{ letterSpacing: '-0.084px', lineHeight: 1.4286 }}
            >
              {copyrightLines.map((line, i) => (
                // oxlint-disable-next-line react/no-array-index-key -- copyright line order is stable
                <p key={i}>{line}</p>
              ))}
            </div>
            {switcherRow}
          </div>
        </SiteContainer>
      ) : (
        <>
          <SiteContainer className={containerClassName}>
            <div className="flex flex-col gap-6 py-6 sm:gap-8 sm:py-8">
              {(logo || brandTrailing) && (
                <div className="flex items-center justify-between gap-3">
                  {logo}
                  {brandTrailing}
                </div>
              )}

              <div
                className={cn('grid gap-x-5 gap-y-6 sm:gap-y-8', linkGridClass)}
              >
                {columns.map((col) => (
                  <nav
                    key={col.heading}
                    aria-label={col.heading}
                    className={cn('flex flex-col gap-2.5', col.className)}
                  >
                    <h3
                      className="text-fg-base text-sm font-medium"
                      style={{ letterSpacing: '-0.14px' }}
                    >
                      {col.heading}
                    </h3>
                    {col.links.length > 0 ? (
                      <ul role="list" className="flex flex-col gap-1.5">
                        {col.links.map((link, i) => (
                          // oxlint-disable-next-line react/no-array-index-key -- link order is stable
                          <li key={i}>{link}</li>
                        ))}
                      </ul>
                    ) : null}
                    {col.body ? (
                      <div className="text-fg-muted text-sm">{col.body}</div>
                    ) : null}
                  </nav>
                ))}
              </div>
            </div>
          </SiteContainer>

          <div className="border-border-base border-t">
            <SiteContainer className={containerClassName}>
              <div className="flex flex-col gap-3 py-4 sm:gap-4 sm:py-5">
                {address ? (
                  <div className="text-fg-muted text-xs sm:text-sm">
                    {address}
                  </div>
                ) : null}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div
                    className="text-fg-muted text-xs sm:text-sm"
                    style={{ letterSpacing: '-0.084px', lineHeight: 1.4286 }}
                  >
                    {copyrightLines.map((line, i) => (
                      // oxlint-disable-next-line react/no-array-index-key -- copyright line order is stable
                      <p key={i}>{line}</p>
                    ))}
                  </div>
                  {switcherRow}
                </div>
              </div>
            </SiteContainer>
          </div>
        </>
      )}
    </footer>
  );
}

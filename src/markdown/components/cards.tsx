import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic';
import { type ReactNode, isValidElement } from 'react';

import { cn } from '../../lib/cn';

const KNOWN_ICON_NAMES = new Set<string>(iconNames);

interface CardProps {
  title?: string;
  /**
   * Either a rendered ReactNode (Storybook / direct JSX usage) or a kebab-case
   * Lucide icon name string for markdown authoring (e.g.
   * `<Card icon="cloud" />`). Unknown names render nothing.
   */
  icon?: ReactNode | string;
  href?: string;
  children?: ReactNode;
  className?: string;
}

function renderIcon(icon: ReactNode | string | undefined): ReactNode {
  if (icon == null || icon === '') return null;
  if (typeof icon === 'string') {
    // Validate against the known Lucide icon set so an unknown name renders
    // *nothing* (no DOM, no flex gap, no broken-icon placeholder) rather
    // than an empty `<DynamicIcon>` shell.
    if (!KNOWN_ICON_NAMES.has(icon)) return null;
    return <DynamicIcon name={icon as IconName} className="size-4" />;
  }
  if (isValidElement(icon)) return icon;
  return null;
}

export function Card({ title, icon, href, children, className }: CardProps) {
  const renderedIcon = renderIcon(icon);
  const trimmedTitle = title?.trim();
  const inner = (
    <>
      {(renderedIcon || trimmedTitle || href) && (
        <div className="flex items-center gap-2">
          {renderedIcon ? (
            <span aria-hidden className="text-fg-base">
              {renderedIcon}
            </span>
          ) : null}
          {trimmedTitle ? (
            <h3 className="text-fg-base text-base font-semibold">
              {trimmedTitle}
            </h3>
          ) : null}
          {href ? (
            <ArrowUpRight
              aria-hidden
              className="text-fg-muted ml-auto size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          ) : null}
        </div>
      )}
      {children ? (
        <div
          className={cn(
            'text-fg-muted text-sm leading-relaxed',
            trimmedTitle || renderedIcon ? 'mt-2' : null,
          )}
        >
          {children}
        </div>
      ) : null}
    </>
  );
  const baseCls = cn(
    'border-border-base bg-bg-base hover:border-border-strong hover:bg-bg-elevated/50 group flex flex-col rounded-lg border p-4 transition-colors',
    className,
  );
  if (!href) return <div className={baseCls}>{inner}</div>;
  if (/^https?:\/\//.test(href)) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={baseCls}
      >
        {inner}
      </a>
    );
  }
  return (
    <Link to={href} className={baseCls}>
      {inner}
    </Link>
  );
}

interface CardGroupProps {
  /**
   * Markdown-authored usage (`<CardGroup cols="3">`) travels through
   * rehype-raw as an HTML attribute, so the value may arrive as a string —
   * accept both forms and coerce before comparing.
   */
  cols?: 1 | 2 | 3 | 4 | '1' | '2' | '3' | '4';
  children?: ReactNode;
}

export function CardGroup({ cols = 2, children }: CardGroupProps) {
  const parsed = Number(cols);
  const colCount = Number.isNaN(parsed) ? 2 : parsed;
  return (
    <div
      className={cn(
        'my-6 grid gap-3',
        colCount === 1 && 'grid-cols-1',
        colCount === 2 && 'grid-cols-1 sm:grid-cols-2',
        colCount === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        colCount === 4 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
      )}
    >
      {children}
    </div>
  );
}

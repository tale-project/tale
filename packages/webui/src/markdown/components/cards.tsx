import { cn } from '@tale/ui/cn';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import { type ReactNode, isValidElement } from 'react';

interface CardProps {
  title?: string;
  /**
   * Either a rendered ReactNode (Storybook / direct JSX usage) or a kebab-case
   * Lucide icon name string (Mintlify-style markdown authoring, e.g.
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
    <Link
      // oxlint-disable-next-line typescript/no-explicit-any -- runtime-typed router target
      to={href as any}
      className={baseCls}
    >
      {inner}
    </Link>
  );
}

interface CardGroupProps {
  cols?: 1 | 2 | 3 | 4;
  children?: ReactNode;
}

export function CardGroup({ cols = 2, children }: CardGroupProps) {
  return (
    <div
      className={cn(
        'my-6 grid gap-3',
        cols === 1 && 'grid-cols-1',
        cols === 2 && 'grid-cols-1 sm:grid-cols-2',
        cols === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        cols === 4 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
      )}
    >
      {children}
    </div>
  );
}

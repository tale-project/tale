import { cn } from '@tale/ui/cn';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';

interface CardProps {
  title: string;
  icon?: ReactNode;
  href?: string;
  children?: ReactNode;
  className?: string;
}

export function Card({ title, icon, href, children, className }: CardProps) {
  const inner = (
    <>
      <div className="flex items-center gap-2">
        {icon ? (
          <span aria-hidden className="text-fg-base">
            {icon}
          </span>
        ) : null}
        <h3 className="text-fg-base text-base font-semibold">{title}</h3>
        {href ? (
          <ArrowUpRight
            aria-hidden
            className="text-fg-muted ml-auto size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          />
        ) : null}
      </div>
      {children ? (
        <div className="text-fg-muted mt-2 text-sm leading-relaxed">
          {children}
        </div>
      ) : null}
    </>
  );
  const baseCls = cn(
    'border-border-base bg-bg-base hover:border-border-strong group flex flex-col rounded-lg border p-4 transition-colors',
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

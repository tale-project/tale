import { cn } from '@tale/ui/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  LocalizedLink,
  type LocalizedRoutePath,
} from '@/app/components/layout/localized-link';
import { Reveal } from '@/app/components/marketing/reveal';

export const marketingCardVariants = cva(
  'group block transition-colors duration-200',
  {
    variants: {
      surface: {
        /** Quiet cell for framed divider panels. */
        plain:
          'hover:bg-surface-site-inset/70 h-full px-5 py-6 md:px-6 md:py-7',
        /** Soft raised tile — prefer sparingly (standalone discovery). */
        raised:
          'border-border-base bg-surface-site-raised shadow-site-card hover:shadow-site-card-hover rounded-xl border p-5',
        inset:
          'border-border-base bg-surface-site-inset hover:bg-surface-site-deep rounded-xl border p-5',
      },
    },
    defaultVariants: {
      surface: 'plain',
    },
  },
);

export interface MarketingCardProps extends VariantProps<
  typeof marketingCardVariants
> {
  /** When set, the card is a locale-aware link. */
  to?: LocalizedRoutePath;
  title: ReactNode;
  description?: ReactNode;
  /** Optional leading icon (platform modules, nav-aligned). */
  icon?: LucideIcon;
  children?: ReactNode;
  className?: string;
  /** Wrap in opacity-only Reveal. */
  reveal?: boolean;
  /** Show a trailing arrow on linked cards (default for `plain`). */
  showArrow?: boolean;
}

/**
 * Marketing tile — related modules, hub grid, discovery cards.
 * Prefer `to` for internal navigation; pass `children` for custom body.
 * Default surface is `plain` (divider-panel cell); use `raised` only when
 * a standalone tile is required.
 */
export function MarketingCard({
  to,
  title,
  description,
  icon: Icon,
  children,
  className,
  surface = 'plain',
  reveal = true,
  showArrow,
}: MarketingCardProps) {
  const classes = cn(marketingCardVariants({ surface }), className);
  const arrow = showArrow ?? (surface === 'plain' && Boolean(to));
  const inner = (
    <>
      {Icon ? (
        <span className="border-border-base bg-surface-site-deep text-fg-base shadow-site-inset mb-4 flex size-10 items-center justify-center rounded-xl border">
          <Icon aria-hidden className="size-4.5" strokeWidth={1.75} />
        </span>
      ) : null}
      <span className="flex items-start justify-between gap-3">
        <span className="text-fg-base block text-lg font-normal tracking-tight">
          {title}
        </span>
        {arrow ? (
          <ArrowRight
            aria-hidden
            className="text-fg-muted group-hover:text-fg-base mt-1 size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5"
          />
        ) : null}
      </span>
      {description ? (
        <span
          className="text-fg-muted mt-2 block text-sm"
          style={{ lineHeight: 1.5 }}
        >
          {description}
        </span>
      ) : null}
      {children}
    </>
  );

  const node = to ? (
    <LocalizedLink to={to} className={classes}>
      {inner}
    </LocalizedLink>
  ) : (
    <div className={classes}>{inner}</div>
  );

  if (!reveal) return node;
  return <Reveal>{node}</Reveal>;
}

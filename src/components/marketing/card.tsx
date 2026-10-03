import { cn } from '@tale/ui/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { useMarketingLink } from '../../routing';
import { Reveal } from './reveal';

const marketingCardVariants = cva(
  'group focus-visible:outline-fg-base block min-w-0 rounded-xl transition-[background-color,box-shadow] duration-200 focus-visible:outline-2 focus-visible:outline-offset-4 motion-reduce:transition-none',
  {
    variants: {
      surface: {
        /** Quiet cell for framed divider panels. */
        plain:
          'hover:bg-surface-site-inset/60 h-full px-5 py-7 md:px-8 md:py-9',
        /** Soft raised tile — prefer sparingly (standalone discovery). */
        raised:
          'border-border-base bg-surface-site-raised shadow-site-card hover:shadow-site-card-hover border p-6',
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
  /** When set, the card is an internal link (rendered through the host's link component). */
  to?: string;
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
  const LinkComponent = useMarketingLink();
  const classes = cn(marketingCardVariants({ surface }), className);
  const arrow = showArrow ?? (surface === 'plain' && Boolean(to));
  const inner = (
    <>
      {Icon ? (
        <span className="border-border-base bg-surface-site-raised text-fg-base mb-6 flex size-10 items-center justify-center rounded-xl border">
          <Icon aria-hidden className="size-4.5" strokeWidth={1.75} />
        </span>
      ) : null}
      <span className="flex items-start justify-between gap-3">
        <span className="text-fg-base block text-lg font-medium tracking-tight">
          {title}
        </span>
        {arrow ? (
          <ArrowRight
            aria-hidden
            className="text-fg-muted group-hover:text-fg-base mt-1 size-4 shrink-0 transition-transform duration-200 motion-safe:group-hover:translate-x-1 motion-safe:group-focus-visible:translate-x-1 motion-reduce:transition-none"
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
    <LinkComponent to={to} className={classes}>
      {inner}
    </LinkComponent>
  ) : (
    <div className={classes}>{inner}</div>
  );

  if (!reveal) return node;
  return <Reveal>{node}</Reveal>;
}

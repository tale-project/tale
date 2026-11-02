import { Card } from '@tale/ui/card';
import { cn } from '@tale/ui/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { useMarketingLink } from '../../routing';
import { Reveal } from './reveal';

const marketingCardVariants = cva(
  'group focus-visible:outline-fg-base relative block h-full min-w-0 transition-[background-color,border-color,box-shadow] duration-200 focus-visible:outline-2 focus-visible:outline-offset-4 motion-reduce:transition-none',
  {
    variants: {
      surface: {
        /** Quiet cell for framed divider panels. */
        plain:
          'hover:bg-surface-site-inset/60 rounded-none border-0 bg-transparent px-5 py-6 md:px-7 md:py-8',
        /** Soft raised tile — prefer sparingly (standalone discovery). */
        raised:
          'bg-surface-site-raised shadow-site-card hover:border-border-strong hover:shadow-site-card-hover p-6 md:p-7',
        inset: 'bg-surface-site-inset hover:bg-surface-site-deep p-5',
        /** Lead destination in an editorial grid. */
        featured: 'bg-surface-site-inset hover:border-border-strong p-6 md:p-8',
        /** A compact destination in a host-owned list or divider grid. */
        quiet: 'rounded-none border-0 bg-transparent px-0 py-5',
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
  /** Show a trailing arrow on linked cards (default when `to` is set). */
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
  const arrow = showArrow ?? Boolean(to);
  const inner = (
    <>
      {Icon ? (
        <span
          className={cn(
            'text-fg-base mb-5 flex size-9 items-center justify-center',
            surface === 'featured' && 'mb-8 size-11',
          )}
        >
          <Icon
            aria-hidden
            className={surface === 'featured' ? 'size-7' : 'size-5'}
            strokeWidth={1.5}
          />
        </span>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            'text-fg-base block text-xl leading-snug font-medium tracking-[-0.025em]',
            surface === 'featured' && 'text-2xl md:text-3xl',
          )}
        >
          {title}
        </div>
        {arrow ? (
          <ArrowRight
            aria-hidden
            className="text-fg-muted group-hover:text-fg-base mt-1 size-4 shrink-0 transition-transform duration-200 motion-safe:group-hover:translate-x-1 motion-safe:group-focus-visible:translate-x-1 motion-reduce:transition-none"
          />
        ) : null}
      </div>
      {description ? (
        <div
          className="text-fg-muted mt-2 block text-sm"
          style={{ lineHeight: 1.6 }}
        >
          {description}
        </div>
      ) : null}
      {children}
    </>
  );

  const node = (
    <Card asChild padding="none" radius="xl" className={classes}>
      {to ? <LinkComponent to={to}>{inner}</LinkComponent> : <div>{inner}</div>}
    </Card>
  );

  if (!reveal) return node;
  return <Reveal>{node}</Reveal>;
}

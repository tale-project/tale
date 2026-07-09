import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';

type ButtonProps = ComponentProps<typeof Button>;

export const marketingButtonVariants = cva(
  'rounded-full border-transparent font-normal shadow-none',
  {
    variants: {
      tone: {
        primary: 'bg-accent-base hover:bg-accent-base/90 text-accent-fg',
        secondary:
          'border-border-base/80 bg-surface-site-inset hover:bg-surface-site-deep text-fg-base border',
      },
      size: {
        default: 'h-9 px-4 text-sm',
        lg: 'h-11 px-7 text-[15px]',
      },
    },
    defaultVariants: {
      tone: 'primary',
      size: 'default',
    },
  },
);

export interface MarketingButtonProps extends VariantProps<
  typeof marketingButtonVariants
> {
  children: ReactNode;
  className?: string;
  asChild?: boolean;
  fullWidth?: boolean;
}

/**
 * Marketing CTA button — ink primary / inset secondary pills.
 * Compose with `asChild` + `MarketingLink` or `MarketingExternalLink`.
 */
export function MarketingButton({
  children,
  tone = 'primary',
  className,
  asChild,
  fullWidth,
  size = 'default',
  ...rest
}: MarketingButtonProps &
  Omit<ButtonProps, 'variant' | 'size' | 'className' | 'children'>) {
  return (
    <Button
      asChild={asChild}
      fullWidth={fullWidth}
      className={cn(marketingButtonVariants({ tone, size }), className)}
      {...rest}
    >
      {children}
    </Button>
  );
}

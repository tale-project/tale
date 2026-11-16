import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';

type ButtonProps = ComponentProps<typeof Button>;

const marketingButtonVariants = cva(
  'site-action focus-visible:outline-fg-base rounded-lg border-transparent font-medium tracking-[-0.01em] focus-visible:outline-2 focus-visible:outline-offset-4',
  {
    variants: {
      tone: {
        primary:
          'bg-accent-base hover:bg-accent-base/90 text-accent-fg shadow-site-button',
        secondary:
          'border-border-base bg-surface-site-raised hover:bg-surface-site-inset text-fg-base border shadow-none',
      },
      size: {
        default: 'h-11 px-4 text-sm sm:h-9',
        lg: 'h-auto min-h-12 max-w-full px-5 py-3 text-sm whitespace-normal sm:px-6',
      },
    },
    defaultVariants: {
      tone: 'primary',
      size: 'default',
    },
  },
);

interface MarketingButtonProps extends VariantProps<
  typeof marketingButtonVariants
> {
  children: ReactNode;
  className?: string;
  asChild?: boolean;
  fullWidth?: boolean;
}

/**
 * Marketing CTA button — ink primary / outlined secondary, with tactile feedback.
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
      variant="ghost"
      asChild={asChild}
      fullWidth={fullWidth}
      className={cn(marketingButtonVariants({ tone, size }), className)}
      {...rest}
    >
      {children}
    </Button>
  );
}

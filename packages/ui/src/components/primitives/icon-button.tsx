'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import {
  forwardRef,
  ComponentPropsWithoutRef,
  cloneElement,
  isValidElement,
  type ReactElement,
} from 'react';

import { cn } from '../../lib/cn';
import { Button, ButtonProps } from './button';

const iconSizeVariants = cva('', {
  variants: {
    iconSize: {
      3: 'size-3',
      4: 'size-4',
      5: 'size-5',
      6: 'size-6',
    },
  },
  defaultVariants: {
    iconSize: 4,
  },
});

interface IconButtonProps
  extends
    Omit<ButtonProps, 'size' | 'children'>,
    VariantProps<typeof iconSizeVariants> {
  /** The Lucide icon component to render */
  icon: LucideIcon;
  /** Additional className for the icon element */
  iconClassName?: string;
  /**
   * Control height: `'default'` is the standard h-9 square button; `'sm'` is
   * the h-8 square for dense bars/toolbars. Mirrors the Button size axis.
   */
  size?: 'default' | 'sm';
  /** Accessible label for the button (required for accessibility) */
  'aria-label': string;
  /**
   * When true, render the underlying `<Button asChild>` so the IconButton
   * can wrap a link or any other element via Radix `<Slot>`. The slot
   * child must be a single React element that accepts the icon as its
   * sole child — pass the actual link via `slotChild`.
   */
  asChild?: boolean;
  /** When `asChild` is true, the element to slot into the IconButton. */
  slotChild?: ReactElement;
}

export const IconButton = forwardRef<
  HTMLButtonElement,
  IconButtonProps & ComponentPropsWithoutRef<'button'>
>(
  (
    {
      icon: Icon,
      iconSize,
      iconClassName,
      variant = 'ghost',
      size = 'default',
      className,
      'aria-label': ariaLabel,
      tooltip,
      asChild,
      slotChild,
      ...props
    },
    ref,
  ) => {
    // Map the IconButton's two heights onto the Button's square icon sizes.
    const buttonSize = size === 'sm' ? 'icon-sm' : 'icon';
    // An icon button always has an accessible name (`aria-label`), so show it
    // as a tooltip for free unless the caller supplies richer `tooltip`
    // content. Skipped for the `asChild` (Slot) path below.
    const resolvedTooltip = tooltip ?? ariaLabel;
    const iconNode = (
      <Icon
        className={cn(
          iconSizeVariants({ iconSize }),
          variant === 'ghost' && 'text-muted-foreground',
          iconClassName,
        )}
        aria-hidden="true"
      />
    );

    // The base Button's `focus-visible:ring-ring` previously resolved to a
    // saturated accent blue that, on a small ghost icon button, read as a
    // heavy halo around an otherwise quiet glyph — visually loud, especially
    // for icon-only toolbar clusters. Override to `border-strong` so focus
    // stays visible for keyboard users (a11y) without the loud ring.
    const focusOverride = 'focus-visible:ring-border-strong';

    if (asChild && isValidElement(slotChild)) {
      // Wrap the consumer's slotChild (typically `<a>` or router `<Link>`)
      // and inject the icon as its sole child via Radix Slot semantics.
      return (
        <Button
          ref={ref}
          asChild
          variant={variant}
          size={buttonSize}
          aria-label={ariaLabel}
          className={cn(focusOverride, className)}
          {...props}
        >
          {cloneElement(slotChild, undefined, iconNode)}
        </Button>
      );
    }

    return (
      <Button
        ref={ref}
        variant={variant}
        size={buttonSize}
        aria-label={ariaLabel}
        tooltip={resolvedTooltip}
        className={cn(focusOverride, className)}
        {...props}
      >
        {iconNode}
      </Button>
    );
  },
);
IconButton.displayName = 'IconButton';

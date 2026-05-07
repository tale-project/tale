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
      className,
      'aria-label': ariaLabel,
      asChild,
      slotChild,
      ...props
    },
    ref,
  ) => {
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

    if (asChild && isValidElement(slotChild)) {
      // Wrap the consumer's slotChild (typically `<a>` or router `<Link>`)
      // and inject the icon as its sole child via Radix Slot semantics.
      return (
        <Button
          ref={ref}
          asChild
          variant={variant}
          size="icon"
          aria-label={ariaLabel}
          className={cn(className)}
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
        size="icon"
        aria-label={ariaLabel}
        className={cn(className)}
        {...props}
      >
        {iconNode}
      </Button>
    );
  },
);
IconButton.displayName = 'IconButton';

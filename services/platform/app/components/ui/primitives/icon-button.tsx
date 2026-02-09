'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { LucideIcon } from 'lucide-react';
import { forwardRef, ComponentPropsWithoutRef } from 'react';

import { cn } from '@/lib/utils/cn';

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
      ...props
    },
    ref,
  ) => (
    <Button
      ref={ref}
      variant={variant}
      size="icon"
      aria-label={ariaLabel}
      className={cn(className)}
      {...props}
    >
      <Icon
        className={cn(
          iconSizeVariants({ iconSize }),
          variant === 'ghost' && 'text-muted-foreground',
          iconClassName,
        )}
        aria-hidden="true"
      />
    </Button>
  ),
);
IconButton.displayName = 'IconButton';

'use client';

import { forwardRef, ComponentPropsWithoutRef } from 'react';
import { LucideIcon } from 'lucide-react';
import { Button, ButtonProps } from './button';
import { cn } from '@/lib/utils/cn';

interface IconButtonProps extends Omit<ButtonProps, 'size' | 'children'> {
  /** The Lucide icon component to render */
  icon: LucideIcon;
  /** Size of the icon (default: 4 = size-4 = 16px) */
  iconSize?: 3 | 4 | 5 | 6;
  /** Additional className for the icon element */
  iconClassName?: string;
  /** Accessible label for the button (required for accessibility) */
  'aria-label': string;
}

const iconSizeClasses = {
  3: 'size-3',
  4: 'size-4',
  5: 'size-5',
  6: 'size-6',
} as const;

const IconButton = forwardRef<
  HTMLButtonElement,
  IconButtonProps & ComponentPropsWithoutRef<'button'>
>(
  (
    {
      icon: Icon,
      iconSize = 4,
      iconClassName,
      variant = 'ghost',
      className,
      'aria-label': ariaLabel,
      ...props
    },
    ref
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
          iconSizeClasses[iconSize],
          variant === 'ghost' && 'text-muted-foreground',
          iconClassName
        )}
      />
    </Button>
  )
);
IconButton.displayName = 'IconButton';

export { IconButton };

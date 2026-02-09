'use client';

import type { ComponentPropsWithoutRef, FC } from 'react';

import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { Button } from '../primitives/button';

const bannerVariants = cva(
  'flex items-center gap-2 rounded-lg border p-3 transition-all',
  {
    variants: {
      variant: {
        info: 'bg-info border-info-foreground/30',
        warning: 'bg-warning/10 border-warning/30',
        success: 'bg-success/10 border-success/30',
        error: 'bg-destructive/10 border-destructive/30',
      },
    },
    defaultVariants: {
      variant: 'info',
    },
  },
);

const bannerTextVariants = cva('grow text-sm leading-normal', {
  variants: {
    variant: {
      info: 'text-info-foreground',
      warning: 'text-warning',
      success: 'text-success',
      error: 'text-destructive',
    },
  },
  defaultVariants: {
    variant: 'info',
  },
});

const bannerIconVariants = cva('shrink-0 size-5', {
  variants: {
    variant: {
      info: 'text-info-foreground',
      warning: 'text-warning',
      success: 'text-success',
      error: 'text-destructive',
    },
  },
  defaultVariants: {
    variant: 'info',
  },
});

const bannerCloseVariants = cva(
  'shrink-0 size-6 cursor-pointer transition-opacity hover:opacity-70',
  {
    variants: {
      variant: {
        info: 'text-info-foreground',
        warning: 'text-warning',
        success: 'text-success',
        error: 'text-destructive',
      },
    },
    defaultVariants: {
      variant: 'info',
    },
  },
);

export interface BannerProps
  extends
    Omit<ComponentPropsWithoutRef<'div'>, 'children'>,
    VariantProps<typeof bannerVariants> {
  readonly variant?: 'info' | 'warning' | 'success' | 'error';
  readonly message: string;
  readonly icon?: FC<{ className?: string }>;
  readonly dismissible?: boolean;
  readonly onClose?: () => void;
  readonly isHidden?: boolean;
}

export function Banner({
  variant = 'info',
  message,
  icon: Icon,
  dismissible = true,
  onClose,
  isHidden = false,
  className,
  ...restProps
}: BannerProps) {
  const { t } = useT('common');

  if (isHidden) {
    return null;
  }

  return (
    <div
      className={cn(bannerVariants({ variant }), className)}
      role="alert"
      {...restProps}
    >
      {Icon && <Icon className={bannerIconVariants({ variant })} />}
      <p className={bannerTextVariants({ variant })}>{message}</p>
      {dismissible && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className={bannerCloseVariants({ variant })}
          aria-label={t('aria.dismiss')}
        >
          <X className="size-full" />
        </Button>
      )}
    </div>
  );
}

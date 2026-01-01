'use client';

import { X } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef, FC } from 'react';

import { cn } from '@/lib/utils/cn';
import { Button } from './ui/button';
import { useT } from '@/lib/i18n';

const bannerVariants = cva(
  'flex items-center gap-2 rounded-lg border p-3 transition-all',
  {
    variants: {
      variant: {
        info: 'bg-blue-50 border-blue-200',
        warning: 'bg-yellow-50 border-yellow-200',
        success: 'bg-green-50 border-green-200',
        error: 'bg-red-50 border-red-200',
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
      info: 'text-blue-600',
      warning: 'text-yellow-700',
      success: 'text-green-700',
      error: 'text-red-700',
    },
  },
  defaultVariants: {
    variant: 'info',
  },
});

const bannerIconVariants = cva('shrink-0 size-5', {
  variants: {
    variant: {
      info: 'text-blue-600',
      warning: 'text-yellow-700',
      success: 'text-green-700',
      error: 'text-red-700',
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
        info: 'text-blue-600',
        warning: 'text-yellow-700',
        success: 'text-green-700',
        error: 'text-red-700',
      },
    },
    defaultVariants: {
      variant: 'info',
    },
  },
);

export interface BannerProps
  extends Omit<ComponentPropsWithoutRef<'div'>, 'children'>,
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

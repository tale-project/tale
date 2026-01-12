'use client';

import { forwardRef, HTMLAttributes, ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';
import { Stack, Center } from './layout';

const statusPageContainerVariants = cva('flex-col px-4', {
  variants: {
    size: {
      default: 'py-[10rem]',
      compact: 'py-16',
    },
  },
  defaultVariants: {
    size: 'default',
  },
});

const statusPageContentVariants = cva('w-full text-center', {
  variants: {
    size: {
      default: 'max-w-[28rem]',
      compact: 'max-w-md',
    },
  },
  defaultVariants: {
    size: 'default',
  },
});

const statusPageTitleVariants = cva('text-foreground', {
  variants: {
    size: {
      default: 'text-3xl font-extrabold tracking-tight',
      compact: 'text-lg font-semibold',
    },
  },
  defaultVariants: {
    size: 'default',
  },
});

const statusPageDescriptionVariants = cva('text-muted-foreground', {
  variants: {
    size: {
      default: '',
      compact: 'text-sm',
    },
  },
  defaultVariants: {
    size: 'default',
  },
});

const statusPageActionsVariants = cva('flex justify-center', {
  variants: {
    size: {
      default: 'gap-3 mt-2',
      compact: 'gap-2',
    },
  },
  defaultVariants: {
    size: 'default',
  },
});

interface StatusPageProps
  extends
    HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof statusPageContainerVariants> {
  /** Optional header element (e.g., logo + user button) */
  header?: ReactNode;
  /** Icon element to display above the title */
  icon?: ReactNode;
  /** Main title text */
  title: string;
  /** Description text below the title */
  description?: string;
  /** Action buttons or links */
  actions?: ReactNode;
  /** Additional content below actions (e.g., support message) */
  footer?: ReactNode;
}

/**
 * StatusPage - Reusable component for status/error pages and empty states
 * Used for 404, error pages, and other full-page status messages
 *
 * ## Example:
 * ```tsx
 * <StatusPage
 *   header={<PageHeader />}
 *   icon={<AlertTriangle className="size-8 text-red-600" />}
 *   title="Something went wrong"
 *   description="We encountered an unexpected error."
 *   actions={<Button onClick={reset}>Try again</Button>}
 * />
 * ```
 */
export const StatusPage = forwardRef<HTMLDivElement, StatusPageProps>(
  (
    {
      header,
      icon,
      title,
      description,
      actions,
      footer,
      size,
      className,
      children,
      ...props
    },
    ref,
  ) => (
    <div ref={ref} className={className} {...props}>
      {header}
      <Center className={cn(statusPageContainerVariants({ size }))}>
        <Stack gap={4} className={cn(statusPageContentVariants({ size }))}>
          {icon && <div className="flex justify-center">{icon}</div>}
          <h2 className={cn(statusPageTitleVariants({ size }))}>{title}</h2>
          {description && (
            <p className={cn(statusPageDescriptionVariants({ size }))}>
              {description}
            </p>
          )}
          {children}
          {actions && (
            <div className={cn(statusPageActionsVariants({ size }))}>
              {actions}
            </div>
          )}
          {footer && <div className="mt-2">{footer}</div>}
        </Stack>
      </Center>
    </div>
  ),
);
StatusPage.displayName = 'StatusPage';

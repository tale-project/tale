'use client';

import { forwardRef, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import { Stack, Center } from './layout';

interface StatusPageProps extends HTMLAttributes<HTMLDivElement> {
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
  /** Size variant - default for full pages, compact for embedded states */
  size?: 'default' | 'compact';
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
const StatusPage = forwardRef<HTMLDivElement, StatusPageProps>(
  (
    {
      header,
      icon,
      title,
      description,
      actions,
      footer,
      size = 'default',
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const isCompact = size === 'compact';

    return (
      <div ref={ref} className={className} {...props}>
        {header}
        <Center
          className={cn(
            'flex-col px-4',
            isCompact ? 'py-16' : 'py-[10rem]',
          )}
        >
          <Stack
            gap={4}
            className={cn(
              'w-full text-center',
              isCompact ? 'max-w-md' : 'max-w-[28rem]',
            )}
          >
            {/* Icon */}
            {icon && (
              <div className="flex justify-center">
                {icon}
              </div>
            )}

            {/* Title */}
            <h2
              className={cn(
                'text-foreground',
                isCompact
                  ? 'text-lg font-semibold'
                  : 'text-3xl font-extrabold tracking-tight',
              )}
            >
              {title}
            </h2>

            {/* Description */}
            {description && (
              <p
                className={cn(
                  'text-muted-foreground',
                  isCompact ? 'text-sm' : '',
                )}
              >
                {description}
              </p>
            )}

            {/* Custom children content */}
            {children}

            {/* Actions */}
            {actions && (
              <div className={cn('flex justify-center', isCompact ? 'gap-2' : 'gap-3 mt-2')}>
                {actions}
              </div>
            )}

            {/* Footer */}
            {footer && <div className="mt-2">{footer}</div>}
          </Stack>
        </Center>
      </div>
    );
  },
);
StatusPage.displayName = 'StatusPage';

export { StatusPage };

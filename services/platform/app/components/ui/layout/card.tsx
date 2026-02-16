import { type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
  footerClassName?: string;
}

export function Card({
  title,
  description,
  children,
  footer,
  className,
  contentClassName,
  headerClassName,
  footerClassName,
}: CardProps) {
  const hasHeader = !!(title || description);

  return (
    <div
      className={cn(
        'rounded-xl border bg-card text-card-foreground shadow-sm',
        className,
      )}
    >
      {hasHeader && (
        <div className={cn('flex flex-col space-y-1.5 p-6', headerClassName)}>
          {title && (
            <div className="text-xl leading-none font-semibold tracking-tight">
              {title}
            </div>
          )}
          {description && (
            <div className="text-muted-foreground text-sm">{description}</div>
          )}
        </div>
      )}
      {children && (
        <div className={cn(hasHeader ? 'p-6 pt-0' : 'p-6', contentClassName)}>
          {children}
        </div>
      )}
      {footer && (
        <div className={cn('flex items-center p-6 pt-0', footerClassName)}>
          {footer}
        </div>
      )}
    </div>
  );
}

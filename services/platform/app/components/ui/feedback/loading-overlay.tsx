'use client';

import { cn } from '@/lib/utils/cn';

import { Spinner } from './spinner';

interface LoadingOverlayProps {
  message: string;
  className?: string;
}

export function LoadingOverlay({ message, className }: LoadingOverlayProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'bg-background/50 absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm',
        className,
      )}
    >
      <div className="text-muted-foreground flex items-center gap-2">
        <Spinner size="sm" label={message} />
        <span className="text-sm">{message}</span>
      </div>
    </div>
  );
}

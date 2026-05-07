import { cn } from '@tale/ui/cn';
import type { ReactNode } from 'react';

interface FrameProps {
  caption?: string;
  children?: ReactNode;
  className?: string;
}

export function Frame({ caption, children, className }: FrameProps) {
  return (
    <figure
      className={cn(
        'border-border-base bg-bg-elevated/40 my-6 overflow-hidden rounded-lg border p-3',
        className,
      )}
    >
      <div className="bg-bg-base overflow-hidden rounded-md [&_img]:h-auto [&_img]:w-full">
        {children}
      </div>
      {caption?.trim() ? (
        <figcaption className="text-fg-muted mt-2 text-center text-xs">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

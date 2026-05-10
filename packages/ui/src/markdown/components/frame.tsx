import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

interface FrameProps {
  caption?: string;
  children?: ReactNode;
  className?: string;
}

/**
 * Bordered figure for screenshots / illustrations. Single border, no
 * inner card-in-card chrome — the content sits directly on the bordered
 * surface and the caption (if any) renders below.
 *
 * Embedded `<img>` is forced to fill the frame width so authors don't
 * have to size every screenshot manually.
 */
export function Frame({ caption, children, className }: FrameProps) {
  return (
    <figure
      className={cn(
        'border-border-base bg-bg-base my-6 overflow-hidden rounded-lg border',
        className,
      )}
    >
      <div className="[&>img]:block [&>img]:h-auto [&>img]:w-full">
        {children}
      </div>
      {caption?.trim() ? (
        <figcaption className="text-fg-muted border-border-base bg-bg-elevated/60 border-t px-4 py-2 text-center text-xs">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

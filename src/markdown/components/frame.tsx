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
 * have to size every screenshot manually. Markdown images never arrive as
 * a direct child — react-markdown wraps them (`<p><img/></p>`) and the
 * base renderer adds a zoom-trigger `<button>` — so the overrides use
 * descendant selectors and also strip the wrapper margins plus the base
 * renderer's own border/rounding, leaving the Frame border as the only
 * chrome.
 */
export function Frame({ caption, children, className }: FrameProps) {
  return (
    <figure
      className={cn(
        'border-border-base bg-bg-base my-6 overflow-hidden rounded-lg border',
        className,
      )}
    >
      <div className="[&_button]:my-0 [&_button]:w-full [&_img]:my-0 [&_img]:block [&_img]:h-auto [&_img]:w-full [&_img]:rounded-none [&_img]:border-0 [&_p]:my-0">
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

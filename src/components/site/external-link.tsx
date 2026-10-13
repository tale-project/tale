import { cn } from '@tale/ui/cn';
import { ExternalLink as ExternalLinkIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

interface ExternalLinkProps extends Omit<
  ComponentProps<'a'>,
  'target' | 'rel'
> {
  showIcon?: boolean;
}

export function ExternalLink({
  children,
  className,
  showIcon = true,
  ...rest
}: ExternalLinkProps) {
  return (
    <a
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'group focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base rounded-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        className,
        // After `className` so caller `inline-block` / `block` cannot drop the
        // icon onto its own line (tailwind-merge keeps the last display utility).
        // The flex row is what keeps the icon beside the label — the label
        // itself may wrap, so a long one ("Hardware Agreement", a German
        // compound) stays inside a narrow footer column instead of running
        // past the screen's edge.
        showIcon && 'inline-flex items-center gap-1',
      )}
      {...rest}
    >
      {showIcon ? (
        <>
          {children}
          <ExternalLinkIcon
            aria-hidden
            className="size-3 shrink-0 opacity-50 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </>
      ) : (
        children
      )}
    </a>
  );
}

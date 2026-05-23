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
        'group inline-flex items-baseline gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg-base/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base',
        className,
      )}
      {...rest}
    >
      <span>{children}</span>
      {showIcon ? (
        <ExternalLinkIcon
          aria-hidden
          className="size-3 shrink-0 self-center opacity-50 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      ) : null}
    </a>
  );
}

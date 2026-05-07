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
      className={cn('inline-flex items-baseline gap-1', className)}
      {...rest}
    >
      <span>{children}</span>
      {showIcon ? (
        <ExternalLinkIcon
          aria-hidden
          className="size-3 shrink-0 self-center opacity-70"
        />
      ) : null}
    </a>
  );
}

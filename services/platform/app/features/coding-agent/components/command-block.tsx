'use client';

import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { useCopy } from '@tale/ui/use-copy';
import { Check, Copy } from 'lucide-react';
import type { ReactNode } from 'react';

interface CommandBlockProps {
  /** What is copied, word for word. */
  code: string;
  /** What is shown when it is not `code` itself (a prompt with its
   * placeholder marked). */
  children?: ReactNode;
  /** The copy button's accessible name. */
  copyLabel: string;
  /** What a screen reader hears once it is copied. */
  copiedLabel: string;
  /** Prose, wrapped at words, rather than a line for a terminal. */
  prose?: boolean;
  onCopy?: () => void;
  className?: string;
}

/**
 * A command or a prompt with a copy button that is always there: a touch
 * screen has no hover to reveal one. Copying says so once, politely, for
 * assistive technology; the button's icon says so for everyone else.
 */
export function CommandBlock({
  code,
  children,
  copyLabel,
  copiedLabel,
  prose = false,
  onCopy,
  className,
}: CommandBlockProps) {
  const { copied, copy } = useCopy({ onSuccess: onCopy });
  const Body = prose ? 'p' : 'pre';
  return (
    <div className={cn('relative', className)}>
      <Body
        className={cn(
          'bg-muted rounded-md py-2.5 pr-12 pl-3 whitespace-pre-wrap',
          prose
            ? 'text-sm leading-6'
            : 'font-mono text-xs leading-5 wrap-anywhere',
        )}
      >
        {children ?? code}
      </Body>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute top-1 right-1"
        aria-label={copyLabel}
        onClick={() => void copy(code)}
      >
        {copied ? (
          <Check className="size-3.5 text-green-600" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </Button>
      <span role="status" className="sr-only">
        {copied ? copiedLabel : ''}
      </span>
    </div>
  );
}

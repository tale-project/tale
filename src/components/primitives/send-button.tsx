'use client';

import { ArrowUp, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Button } from './button';

export interface SendButtonProps {
  /** The verb, already translated ("Send", "Comment") — the button's name. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Why nothing can be sent right now, shown as a tooltip while disabled. */
  disabledReason?: ReactNode;
  /** The send is in flight: a spinner replaces the arrow. */
  sending?: boolean;
  className?: string;
}

/**
 * The round send control at the foot of a composer — a chat message, a task
 * comment, a reply to a customer. One control for all of them, so the three
 * composers that share a frame (`CHAT_COMPOSER_FRAME_CLASS`) also share the
 * one thing a writer reaches for: the same filled circle and arrow, dimmed
 * while there is nothing to send, spinning while it goes.
 */
export function SendButton({
  label,
  onClick,
  disabled = false,
  disabledReason,
  sending = false,
  className,
}: SendButtonProps) {
  return (
    <Button
      variant="primary"
      size="icon"
      onClick={onClick}
      disabled={disabled || sending}
      disabledReason={disabled ? disabledReason : undefined}
      aria-label={label}
      aria-busy={sending || undefined}
      className={cn('shrink-0 rounded-full', className)}
    >
      {sending ? (
        <Loader2
          aria-hidden
          className="size-4 animate-spin motion-reduce:animate-none"
        />
      ) : (
        <ArrowUp aria-hidden className="size-4" />
      )}
    </Button>
  );
}

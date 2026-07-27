'use client';

/**
 * The actions under one settled assistant message — Copy and Show info (the
 * feedback pair and the overflow menu land with their own phases).
 *
 * The LAST message's toolbar is always visible; history rows reveal on hover,
 * keyboard focus, or coarse pointers (the hover group lives on the message
 * item, `group/message`). An errored or blocked turn keeps only Show info:
 * there is no answer worth copying, but the "what happened" trail matters
 * most exactly then.
 */

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Check, Copy, Info } from 'lucide-react';
import { useState } from 'react';

import { useCopy } from '@/app/hooks/use-copy';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { messagePlainText } from '../lib/message-text';
import type { ChatMessageView } from '../types';
import { MessageInfoDialog } from './message-info-dialog';

export function MessageToolbar({
  message,
  alwaysVisible,
}: {
  message: ChatMessageView;
  /** The last message keeps its toolbar on screen; history rows reveal it. */
  alwaysVisible: boolean;
}) {
  const { t: tCommon } = useT('common');
  const { copied, copy } = useCopy();
  const [infoOpen, setInfoOpen] = useState(false);

  const errored =
    message.error !== undefined || message.blockedReason !== undefined;
  const text = messagePlainText(message.parts);

  return (
    <Row
      gap={1}
      className={cn(
        'mt-1',
        !alwaysVisible &&
          'opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100',
      )}
    >
      {!errored && text.length > 0 && (
        <Button
          size="icon"
          variant="ghost"
          aria-label={
            copied ? tCommon('actions.copied') : tCommon('actions.copy')
          }
          data-testid="message-copy-button"
          onClick={() => void copy(text)}
          className="size-7"
        >
          {copied ? (
            <Check aria-hidden className="text-success size-3.5" />
          ) : (
            <Copy aria-hidden className="size-3.5" />
          )}
        </Button>
      )}
      <Button
        size="icon"
        variant="ghost"
        aria-label={tCommon('actions.showInfo')}
        data-testid="message-info-button"
        onClick={() => setInfoOpen(true)}
        className="size-7"
      >
        <Info aria-hidden className="size-3.5" />
      </Button>
      {/* Mounted only while open — a hidden dialog per history row would be
          pure overhead in long threads. */}
      {infoOpen && (
        <MessageInfoDialog
          message={message}
          open={infoOpen}
          onOpenChange={setInfoOpen}
        />
      )}
    </Row>
  );
}

'use client';

import { Button } from '@tale/ui/button';
import { CappedScrollRegion } from '@tale/ui/capped-scroll-region';
import { Text } from '@tale/ui/text';
import { WandSparklesIcon } from 'lucide-react';
import { useId } from 'react';

import { useT } from '@/lib/i18n/client';

export interface SuggestedReplyCardProps {
  /** The reply an automation proposed, as it would be sent. */
  body: string;
  /** The person put it into the editor: the card shrinks to a status line,
   * so the composer's text reads as theirs from here on. */
  used: boolean;
  discarding: boolean;
  onUse: () => void;
  onDiscard: () => void;
}

/**
 * An automation's drafted reply, shown beside the composer rather than typed
 * into it: what a person wrote and what a model proposed stay apart until
 * the person decides. **Put in editor** hands the text to the composer to
 * edit and send (the send completes the proposal); **Discard** rejects it,
 * and the thread is not proposed on again until the customer writes again.
 */
export function SuggestedReplyCard({
  body,
  used,
  discarding,
  onUse,
  onDiscard,
}: SuggestedReplyCardProps) {
  const { t } = useT('conversations');
  const headingId = useId();

  if (used) {
    return (
      <Text as="p" role="status" variant="muted" className="text-xs">
        {t('suggestedReply.used')}
      </Text>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <WandSparklesIcon
            className="text-muted-foreground mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <div className="flex flex-col gap-1">
            <Text as="h3" id={headingId} className="text-sm font-medium">
              {t('suggestedReply.title')}
            </Text>
            <Text as="p" variant="muted" className="text-xs">
              {t('suggestedReply.description')}
            </Text>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            isLoading={discarding}
            onClick={onDiscard}
          >
            {t('suggestedReply.discard')}
          </Button>
          <Button size="sm" disabled={discarding} onClick={onUse}>
            {t('suggestedReply.use')}
          </Button>
        </div>
      </div>
      <CappedScrollRegion
        maxHeightClassName="max-h-48"
        scrollLabel={t('suggestedReply.title')}
      >
        <Text as="p" className="text-sm whitespace-pre-wrap">
          {body}
        </Text>
      </CappedScrollRegion>
    </section>
  );
}

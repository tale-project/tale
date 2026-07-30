'use client';

import { Row } from '@tale/ui/layout';
import { TextQuote, X } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/**
 * Removable "quoted text" chip shown above the composer field. Populated by
 * the floating selection-quote affordance on messages; the staged text is
 * prepended as a markdown blockquote when the next message is sent (see
 * `Composer.submit`). Renders nothing when no quote is staged.
 */
export function QuotedReferenceChip({
  quotedText,
  onClear,
}: {
  quotedText: string | null;
  onClear: () => void;
}) {
  const { t } = useT('chat');

  if (quotedText === null || quotedText.length === 0) return null;

  return (
    <Row
      gap={2}
      align="start"
      className="border-border bg-muted/60 mb-2 rounded-lg border px-3 py-2"
    >
      <TextQuote
        className="text-muted-foreground mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="text-muted-foreground text-xs font-medium">
          {t('quote.label')}
        </div>
        <p className="text-foreground line-clamp-2 text-sm break-words">
          {quotedText}
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        aria-label={t('quote.remove')}
        className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-6 shrink-0 items-center justify-center rounded-full transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </Row>
  );
}

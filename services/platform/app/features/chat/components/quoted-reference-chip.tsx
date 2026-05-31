'use client';

import { TextQuote, X } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { useChatLayout } from '../context/chat-layout-context';

/**
 * Removable "quoted text" chip shown above the composer. Populated by the
 * floating SelectionQuoteButton; the staged text is prepended as a markdown
 * blockquote when the next message is sent (see chat-input handleSendMessage).
 * Renders nothing when no quote is staged.
 */
export function QuotedReferenceChip() {
  const { t } = useT('chat');
  const { quotedText, setQuotedText } = useChatLayout();

  if (!quotedText) return null;

  return (
    <div className="border-border bg-muted/60 mb-2 flex items-start gap-2 rounded-lg border px-3 py-2">
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
        onClick={() => setQuotedText(null)}
        aria-label={t('quote.remove')}
        className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-6 shrink-0 items-center justify-center rounded-full transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

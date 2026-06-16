'use client';

import { Button } from '@tale/ui/button';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { RotateCcw, TriangleAlert } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { sanitizeChatError } from '../utils/sanitize-chat-error';

interface ChatErrorDisplayProps {
  /** Raw error string stored on the message (the verbatim provider error). */
  error: string | undefined;
  onRetry?: () => void;
}

/**
 * Renders a failed/aborted chat turn's error: a friendly, classified hint plus
 * the verbatim provider error tucked behind a collapsed "Technical details"
 * disclosure. The raw error is always available (it's needed to debug provider
 * misconfigurations — e.g. an Azure reasoning deployment rejecting `max_tokens`
 * is otherwise mislabeled as a token-limit problem). Unknown ("generic") errors
 * open the disclosure by default since the raw text is the only signal.
 */
export function ChatErrorDisplay({ error, onRetry }: ChatErrorDisplayProps) {
  const { t: tChat } = useT('chat');
  const sanitized = sanitizeChatError(error);

  return (
    <div className="mt-3 flex flex-col gap-2" role="alert" aria-live="polite">
      <div className="text-destructive flex items-center gap-2">
        <TriangleAlert className="size-4 shrink-0" />
        <span className="text-sm font-medium">{tChat('errorGenerating')}</span>
      </div>
      <p className="text-muted-foreground text-[13px]">
        {tChat(sanitized.i18nKey)}
      </p>
      {error && (
        <CollapsibleDetails
          variant="compact"
          summary={tChat('errorDetailsSummary')}
          open={sanitized.category === 'generic'}
        >
          <p className="text-muted-foreground mt-1 font-mono text-xs break-all whitespace-pre-wrap opacity-70">
            {error}
          </p>
        </CollapsibleDetails>
      )}
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          className="text-foreground w-fit gap-1.5 rounded-lg border-[#E5E7EB] bg-transparent px-3 py-1.5 text-[13px] font-medium"
          onClick={onRetry}
        >
          <RotateCcw className="size-3.5" />
          {tChat('retryGeneration')}
        </Button>
      )}
    </div>
  );
}

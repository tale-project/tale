'use client';

import { Button } from '@tale/ui/button';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { Row, Stack } from '@tale/ui/layout';
import { RotateCcw, TriangleAlert } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { sanitizeChatError } from '../utils/sanitize-chat-error';
import { ProviderKeyErrorAction } from './provider-settings-action';

interface ChatErrorDisplayProps {
  /** Raw error string stored on the message (envelope or verbatim). */
  error: string | undefined;
  onRetry?: () => void;
  /**
   * Org for the "Open provider settings" deep link on a missing-API-key error.
   * Optional so surfaces without an org context (if any) still render the hint.
   */
  organizationId?: string;
}

/**
 * Renders a failed chat turn's error: a friendly, classified hint plus the
 * verbatim provider error tucked behind a collapsed "Technical details"
 * disclosure. The raw error is always available (it's needed to debug provider
 * misconfigurations — e.g. an Azure reasoning deployment rejecting `max_tokens`
 * is otherwise mislabeled as a token-limit problem). Unknown ("generic") errors
 * open the disclosure by default since the raw text is the only signal.
 */
export function ChatErrorDisplay({
  error,
  onRetry,
  organizationId,
}: ChatErrorDisplayProps) {
  const { t: tChat } = useT('chat');
  const sanitized = sanitizeChatError(error);

  return (
    <Stack gap={2} className="mt-3" role="alert" aria-live="polite">
      <Row gap={2} className="text-destructive">
        <TriangleAlert className="size-4 shrink-0" />
        <span className="text-sm font-medium">{tChat('errorGenerating')}</span>
      </Row>
      <p className="text-muted-foreground text-[13px]">
        {tChat(sanitized.i18nKey, sanitized.params)}
      </p>
      {sanitized.triedCount != null && (
        <p className="text-muted-foreground/70 text-xs">
          {tChat('errorTriedModels', { count: sanitized.triedCount })}
        </p>
      )}
      {sanitized.rawMessage && (
        <CollapsibleDetails
          variant="compact"
          summary={tChat('errorDetailsSummary')}
          open={sanitized.code === 'generic'}
        >
          <p className="text-muted-foreground mt-1 font-mono text-xs break-all whitespace-pre-wrap opacity-70">
            {sanitized.rawMessage}
          </p>
        </CollapsibleDetails>
      )}
      {sanitized.code === 'missing_api_key' && organizationId && (
        <ProviderKeyErrorAction organizationId={organizationId} />
      )}
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          className="w-fit gap-1.5"
          onClick={onRetry}
        >
          <RotateCcw className="size-3.5" />
          {tChat('retryGeneration')}
        </Button>
      )}
    </Stack>
  );
}

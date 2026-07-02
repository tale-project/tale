import { AlertTriangle } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { parseGenerationIncompleteBody } from '@/lib/shared/constants/system-message-tags';

interface GenerationIncompleteNoticeProps {
  /** The `[GENERATION_INCOMPLETE]` body (structured `tools=a,b`). */
  body: string;
}

/**
 * Renders a `[GENERATION_INCOMPLETE]` system message — a turn that exhausted
 * its retries without a final answer — as a localized one-line warning, in
 * place of the old English fallback sentence that posed as the assistant's
 * own reply.
 */
export function GenerationIncompleteNotice({
  body,
}: GenerationIncompleteNoticeProps) {
  const { t } = useT('chat');
  const { tools } = parseGenerationIncompleteBody(body);

  const line =
    tools && tools.length > 0
      ? t('generationIncompleteWithTools', { tools: tools.join(', ') })
      : t('generationIncomplete');

  return (
    <div className="text-warning flex items-center gap-1.5 px-4 py-1 text-xs">
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{line}</span>
    </div>
  );
}

import { Info } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { parseStepLimitBody } from '@/lib/shared/constants/system-message-tags';

interface StepLimitNoticeProps {
  /** The `[STEP_LIMIT_CONTINUED]` / `[STEP_LIMIT_REACHED]` body (`round=N`). */
  body: string;
  variant: 'continued' | 'reached';
}

/**
 * Renders a step-limit system message — a tool-heavy turn that used up its
 * per-round step budget — as a neutral, localized info line: the turn either
 * continued automatically (CONTINUED) or stopped here (REACHED). A capacity
 * stop is expected behaviour, so this is deliberately NOT a warning.
 */
export function StepLimitNotice({ body, variant }: StepLimitNoticeProps) {
  const { t } = useT('chat');
  const { round } = parseStepLimitBody(body);

  const line =
    variant === 'continued'
      ? round !== undefined
        ? t('stepLimitContinuedRound', { round })
        : t('stepLimitContinued')
      : t('stepLimitReached');

  return (
    <div className="text-muted-foreground flex items-center gap-1.5 px-4 py-1 text-xs">
      <Info className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{line}</span>
    </div>
  );
}

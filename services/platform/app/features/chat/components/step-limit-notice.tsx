'use client';

import { Info } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

/**
 * Whether the turn spent its tool-round budget (the loop withheld the tools
 * for the final round and forced an answer). Read structurally: the pipeline
 * stamps `usage.stepLimitHit` and the view type gains the field in a parallel
 * patch — until then the stamp is simply absent and this reads false.
 */
export function stepLimitHit(usage: unknown): boolean {
  return isRecord(usage) && usage.stepLimitHit === true;
}

/**
 * A tool-heavy turn that used up its round budget stopped investigating and
 * answered with what it had — a capacity stop is expected behaviour, so this
 * is a neutral, localized info line, deliberately NOT a warning.
 */
export function StepLimitNotice() {
  const { t } = useT('chat');
  return (
    <div className="text-muted-foreground flex items-center gap-1.5 py-1 text-xs">
      <Info className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{t('stepLimitReached')}</span>
    </div>
  );
}

'use client';

import { Check, Loader2, AlertCircle } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

export const AUTO_SAVE_PORTAL_ID = 'auto-save-indicator-portal';

interface AutoSaveIndicatorProps {
  status: 'idle' | 'saving' | 'saved' | 'error';
}

export function AutoSaveIndicator({ status }: AutoSaveIndicatorProps) {
  const { t } = useT('common');

  if (status === 'idle') return null;

  return (
    <div
      className="text-muted-foreground flex items-center gap-1.5 text-xs"
      aria-live="polite"
    >
      {status === 'saving' && (
        <>
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          <span>{t('actions.saving')}</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <Check className="size-3 text-green-600" aria-hidden="true" />
          <span>{t('actions.saved')}</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="text-destructive size-3" aria-hidden="true" />
          <span>{t('actions.saveFailed')}</span>
        </>
      )}
    </div>
  );
}

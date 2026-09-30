'use client';

import { toast } from '@tale/ui/use-toast';
import { useCallback } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import type { WebsiteDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import { isScanPaused } from '../lib/scan-paused';
import { useScanWebsiteNow } from './mutations';

/**
 * "Scan now" for one website — the row menu's and the details dialog's one
 * action. Offered to writers while the site is neither scanning nor being
 * deleted; a paused site has **Resume scanning** in its place, which also
 * clears the pause.
 */
export function useScanNow(website: WebsiteDoc): {
  available: boolean;
  scanNow: () => void;
} {
  const { t } = useT('websites');
  const canWrite = useAbility().can('write', 'knowledgeWrite');
  const { mutate } = useScanWebsiteNow();

  const available =
    canWrite &&
    !isScanPaused(website) &&
    website.status !== 'scanning' &&
    website.status !== 'deleting';

  const scanNow = useCallback(() => {
    mutate(
      { websiteId: website._id },
      {
        onSuccess: ({ queued }) => {
          // "Already running" reports that nothing was started, in neutral
          // colours: the scan that runs was not this click's doing.
          toast(
            queued
              ? { title: t('toast.scanStarted'), variant: 'success' }
              : { title: t('toast.scanAlreadyRunning') },
          );
        },
      },
    );
  }, [mutate, website._id, t]);

  return { available, scanNow };
}

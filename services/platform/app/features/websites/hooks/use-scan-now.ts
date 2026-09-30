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
 * clears the pause. `pending` holds while the request is out.
 *
 * The answer is told from the action's own success, not the click's: a
 * click's callback fires for the last click only, and not at all once the
 * dialog it came from has closed, so a scan could start without a word.
 */
export function useScanNow(website: WebsiteDoc): {
  available: boolean;
  pending: boolean;
  scanNow: () => void;
} {
  const { t } = useT('websites');
  const canWrite = useAbility().can('write', 'knowledgeWrite');
  const { mutate, isPending } = useScanWebsiteNow({
    onSuccess: ({ queued }) => {
      // "Already running" reports that nothing was started, in neutral
      // colours: the scan that runs was not this click's doing.
      toast(
        queued
          ? { title: t('toast.scanStarted'), variant: 'success' }
          : { title: t('toast.scanAlreadyRunning') },
      );
    },
  });

  const available =
    canWrite &&
    !isScanPaused(website) &&
    website.status !== 'scanning' &&
    website.status !== 'deleting';

  const scanNow = useCallback(() => {
    mutate({ websiteId: website._id });
  }, [mutate, website._id]);

  return { available, pending: isPending, scanNow };
}

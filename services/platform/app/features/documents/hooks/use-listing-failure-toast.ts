import { toast } from '@tale/ui/use-toast';
import { useEffect } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';

import { CloudListingError } from '../lib/cloud-listing-error';

/**
 * The one report of a cloud listing that failed: the picker has no error
 * state of its own, and the listing's write stays quiet so a query retrying
 * it never raises a toast per attempt. `error` is the query's, set once its
 * retries are spent, so each failed fetch toasts once. `handedOff` names the
 * errors the dialog answers otherwise — a lapsed grant opens the connect
 * dialog, which says what happened.
 *
 * A refusal the door answered says why under the title. A listing the
 * provider answered `success: false` (`CloudListingError`) carries the
 * provider's raw answer, in English: it goes to the log, and the toast keeps
 * its localized title alone.
 */
export function useListingFailureToast(
  error: unknown,
  title: string,
  handedOff: (error: unknown) => boolean,
): void {
  useEffect(() => {
    if (error === null || error === undefined || handedOff(error)) return;
    const unworded = error instanceof CloudListingError;
    if (unworded) console.warn('Cloud listing failed:', error.message);
    toast({
      title,
      description: unworded ? undefined : failureDetail(error),
      variant: 'destructive',
    });
  }, [error, title, handedOff]);
}

import { toast } from '@tale/ui/use-toast';
import { useCallback } from 'react';

import type { Session } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { settle } from '../lib/settle';
import { useSessionActions } from './use-session-actions';

/**
 * Looks at a running session's proxy again, and says what it found: the exit
 * IP is still the one the time zone and location are for, or it is another
 * now. The menu's "Check IP" and the details of the session both do exactly
 * this, so the words live here once.
 */
export function useCheckIp() {
  const { t } = useT('sessions');
  const { checkIp } = useSessionActions();

  const announce = useCallback(
    (checked: Session) => {
      const place = checked.location;
      const now = checked.proxy?.exitIp;
      if (place?.inSync === false && now) {
        toast({
          variant: 'warning',
          title: t('notices.ipChangedTitle'),
          description: t('notices.ipChanged', { now, was: place.ip }),
        });
      } else if (place?.inSync === true) {
        toast({
          variant: 'success',
          title: t('notices.ipSameTitle'),
          description: t('notices.ipSame', { ip: place.ip }),
        });
      }
    },
    [t],
  );

  const { mutateAsync } = checkIp;
  const check = useCallback(
    (id: number) => {
      const checkAndAnnounce = async () => {
        const result = await settle(mutateAsync({ id }));
        // A failure was told as a toast by the write itself.
        if (result.ok) announce(result.value);
      };
      void checkAndAnnounce();
    },
    [mutateAsync, announce],
  );

  return { check, isPending: checkIp.isPending };
}

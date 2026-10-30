import { toast } from '@tale/ui/use-toast';
import { useState } from 'react';

import { useAuth } from '@/app/hooks/use-session-user';
import { redirectToLogIn } from '@/app/lib/auth/log-in-redirect';
import { useT } from '@/lib/i18n/client';

/**
 * Sign in again from the page the person is on: end this session, then take
 * the tab to sign-in, which brings them back here once they have signed in.
 * The session ends first: the sign-in page sends a live session straight
 * back to the dashboard. A session an authenticating proxy asserted is the
 * proxy's to end, as the account menu has it, so it is not `offered`.
 */
export function useSignInAgain() {
  const { signOut, proxied } = useAuth();
  const { t } = useT('auth');
  const [leaving, setLeaving] = useState(false);

  const signInAgain = async () => {
    setLeaving(true);
    try {
      await signOut();
    } catch (error) {
      console.warn('[auth] Ending the session to sign in again failed', error);
      setLeaving(false);
      toast({
        title: t('userButton.toast.signOutFailed'),
        variant: 'destructive',
      });
      return;
    }
    redirectToLogIn();
  };

  return { offered: !proxied, leaving, signInAgain };
}

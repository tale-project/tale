import { Toaster } from '@tale/ui/toaster';
import { useToast } from '@tale/ui/use-toast';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useEffectEvent } from 'react';
import { z } from 'zod';

import { AccountsScreen } from '@/app/components/accounts-screen';
import { gatewayApi, type AuthorizationStatus } from '@/app/lib/api';
import { authorizationErrorKey } from '@/app/lib/authorization-errors';
import { useAccounts, useProviders } from '@/app/lib/use-gateway';
import { useT } from '@/lib/i18n/client';

const searchSchema = z.object({
  /**
   * The authorization a vendor's redirect just finished, by its `state`.
   * `/callback` sends the browser here with it; the panel reports how the
   * sign-in went and drops it again.
   */
  authorization: z.string().optional(),
});

export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
  component: PanelPage,
});

/**
 * The whole panel: one screen, and no door of its own.
 *
 * The gateway asks nobody to sign in — a deployment puts whatever gate it
 * wants in front of this origin — so the account list is read straight away
 * rather than after a session check.
 */
function PanelPage() {
  const { accounts, error, reload } = useAccounts();
  const providers = useProviders();
  useRedirectOutcome(reload);

  return (
    <>
      <AccountsScreen
        accounts={accounts}
        error={error}
        onReload={reload}
        providers={providers}
      />
      <Toaster />
    </>
  );
}

/**
 * Say how a redirected sign-in went.
 *
 * The vendor sent the browser to the gateway's `/callback`, which finished
 * the grant there and passed the browser on to this page with the
 * authorization's `state` — the one way this panel learns the outcome of a
 * sign-in it did not see end. Read it, say it, and drop the parameter, so a
 * reload does not say it twice.
 */
function useRedirectOutcome(onConnected: () => void) {
  const { authorization } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { t } = useT('addAccount');
  const { toast } = useToast();

  const report = useEffectEvent((status: AuthorizationStatus) => {
    if (status.status === 'connected') {
      toast({
        title: t('connected', { label: status.account.label }),
        variant: 'success',
      });
      onConnected();
      return;
    }
    // A sign-in still pending here never finished: `/callback` answered
    // without completing it, which is a failure the reader should hear of.
    const code = status.status === 'failed' ? status.code : 'failed';
    toast({ title: t(authorizationErrorKey(code)), variant: 'destructive' });
  });

  useEffect(() => {
    if (!authorization) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const status = await gatewayApi.authorizationStatus(authorization);
        if (!cancelled) report(status);
      } catch (cause) {
        console.warn(
          '[ai-gateway] reading how the sign-in went failed:',
          cause,
        );
      }
      if (!cancelled) void navigate({ search: {}, replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [authorization, navigate]);
}

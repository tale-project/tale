import { Toaster } from '@tale/ui/toaster';
import { createFileRoute } from '@tanstack/react-router';

import { AccountsScreen } from '@/app/components/accounts-screen';
import { useAccounts, useProviders } from '@/app/lib/use-gateway';

export const Route = createFileRoute('/')({
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
  const { accounts, isLoading, error, reload } = useAccounts();
  const providers = useProviders();

  return (
    <>
      <AccountsScreen
        accounts={accounts}
        error={error}
        isLoading={isLoading}
        onReload={reload}
        providers={providers}
      />
      <Toaster />
    </>
  );
}

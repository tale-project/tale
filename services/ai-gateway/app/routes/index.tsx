import { FullPageCenter } from '@tale/ui/full-page-center';
import { Spinner } from '@tale/ui/spinner';
import { Toaster } from '@tale/ui/toaster';
import { createFileRoute } from '@tanstack/react-router';

import { AccountsScreen } from '@/app/components/accounts-screen';
import { SignInScreen } from '@/app/components/sign-in-screen';
import { useAccounts, useProviders, useSession } from '@/app/lib/use-gateway';

export const Route = createFileRoute('/')({
  component: PanelPage,
});

/**
 * The whole panel: one screen behind one password.
 *
 * The session check runs before anything is drawn, so a signed-in operator
 * never sees the sign-in form flash past on a reload.
 */
function PanelPage() {
  const { state, signIn, signOut } = useSession();
  const signedIn = state === 'signed-in';
  const { accounts, isLoading, error, reload } = useAccounts(signedIn);
  const providers = useProviders(signedIn);

  return (
    <>
      {state === 'unknown' ? (
        <FullPageCenter>
          <Spinner />
        </FullPageCenter>
      ) : state === 'signed-out' ? (
        <SignInScreen onSignIn={signIn} />
      ) : (
        <AccountsScreen
          accounts={accounts}
          error={error}
          isLoading={isLoading}
          onReload={reload}
          onSignOut={() => void signOut()}
          providers={providers}
        />
      )}
      <Toaster />
    </>
  );
}

import { createFileRoute } from '@tanstack/react-router';

import { AccountForm } from '@/app/features/settings/account/components/account-form';
import { ensureConvexQuery } from '@/app/lib/loader-preload';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/account')({
  head: () => ({
    meta: seo('account'),
  }),
  // Warm the small gating queries the form reads so warm navigations render
  // the real fields on first paint (no skeleton flash). Best-effort.
  loader: ({ context }) => {
    void ensureConvexQuery(context, api.users.queries.getCurrentUser, {}).catch(
      console.warn,
    );
    void ensureConvexQuery(
      context,
      api.accounts.queries.hasCredentialAccount,
      {},
    ).catch(console.warn);
  },
  component: AccountPage,
});

function AccountPage() {
  return <AccountForm />;
}

import { createFileRoute } from '@tanstack/react-router';

import { AccountForm } from '@/app/features/settings/account/components/account-form';
import { accountFlagsQuery, currentUserQuery } from '@/app/lib/backend/account';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/account')({
  head: () => ({
    meta: seo('account'),
  }),
  // Warm the small gating queries the form reads so warm navigations render
  // the real fields on first paint (no skeleton flash). Best-effort.
  loader: ({ context }) => {
    void context.queryClient
      .ensureQueryData(currentUserQuery())
      .catch(console.warn);
    void context.queryClient
      .ensureQueryData(accountFlagsQuery())
      .catch(console.warn);
  },
  component: AccountPage,
});

function AccountPage() {
  return <AccountForm />;
}

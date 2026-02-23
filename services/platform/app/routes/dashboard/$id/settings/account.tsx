import { createFileRoute } from '@tanstack/react-router';

import { AccountForm } from '@/app/features/settings/account/components/account-form';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/account')({
  head: () => ({
    meta: seo('account'),
  }),
  component: AccountPage,
});

function AccountPage() {
  return <AccountForm />;
}

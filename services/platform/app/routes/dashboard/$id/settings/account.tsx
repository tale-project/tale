import { createFileRoute } from '@tanstack/react-router';

import { AccountForm } from '@/app/features/settings/account/components/account-form';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/account')({
  head: () => ({
    meta: seo('account'),
  }),
  component: AccountPage,
});

function AccountPage() {
  const { id: organizationId } = Route.useParams();
  const { data: memberContext } = useCurrentMemberContext(organizationId);

  if (!memberContext) {
    return null;
  }

  return <AccountForm memberContext={memberContext} />;
}

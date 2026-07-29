import { createFileRoute } from '@tanstack/react-router';

import { ConnectorsSettings } from '@/app/features/settings/connectors/components/connectors-settings';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/connectors')({
  head: () => ({ meta: seo('connectors') }),
  component: ConnectorsPage,
});

function ConnectorsPage() {
  const { id: organizationId } = Route.useParams();
  return <ConnectorsSettings organizationId={organizationId} />;
}

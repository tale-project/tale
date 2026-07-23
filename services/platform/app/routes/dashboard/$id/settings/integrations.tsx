import { createFileRoute } from '@tanstack/react-router';

import { IntegrationsSettings } from '@/app/features/settings/integrations/components/integrations-settings';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/integrations')({
  head: () => ({ meta: seo('integrations') }),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const { id: organizationId } = Route.useParams();
  return <IntegrationsSettings organizationId={organizationId} />;
}

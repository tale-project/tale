import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { ModelEndpointsSection } from '@/app/features/settings/model-endpoints/components/model-endpoints-section';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/api/models')({
  head: () => ({ meta: seo('modelEndpoints') }),
  component: ApiModelsPage,
});

// The model endpoints for API keys: how a key holder points opencode, Claude
// Code or an SDK at the organization's models. Access is gated by the parent
// `api` route layout (developer roles, or the `tale:models.api` grant).
function ApiModelsPage() {
  const { id: organizationId } = Route.useParams();
  return (
    <SettingsPage>
      <ModelEndpointsSection organizationId={organizationId} />
    </SettingsPage>
  );
}

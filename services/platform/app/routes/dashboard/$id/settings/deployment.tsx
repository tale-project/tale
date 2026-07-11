import { createFileRoute } from '@tanstack/react-router';

import { DeploymentSettings } from '@/app/features/settings/deployment/components/deployment-settings';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/deployment')({
  head: () => ({ meta: seo('deployment') }),
  component: DeploymentSettingsPage,
});

function DeploymentSettingsPage() {
  return <DeploymentSettings />;
}

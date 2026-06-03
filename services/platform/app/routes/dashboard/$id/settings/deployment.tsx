import { createFileRoute } from '@tanstack/react-router';

import { DeploymentSettings } from '@/app/features/settings/deployment/components/deployment-settings';

export const Route = createFileRoute('/dashboard/$id/settings/deployment')({
  component: DeploymentSettingsPage,
});

function DeploymentSettingsPage() {
  return <DeploymentSettings />;
}

import { createFileRoute } from '@tanstack/react-router';

import { UsageFiles } from '@/app/features/settings/usage/components/usage-files';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/usage/files')({
  head: () => ({
    meta: seo('usageFiles'),
  }),
  component: UsageFilesPage,
});

function UsageFilesPage() {
  const { id } = Route.useParams();
  return <UsageFiles organizationId={id} />;
}

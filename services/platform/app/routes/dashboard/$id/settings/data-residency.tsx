import { createFileRoute } from '@tanstack/react-router';

import { DataResidencySettings } from '@/app/features/settings/data-residency/components/data-residency-settings';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/data-residency')({
  head: () => ({ meta: seo('dataResidency') }),
  component: DataResidencyPage,
});

function DataResidencyPage() {
  const { id: organizationId } = Route.useParams();
  return <DataResidencySettings organizationId={organizationId} />;
}

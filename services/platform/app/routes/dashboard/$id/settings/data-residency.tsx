import { createFileRoute } from '@tanstack/react-router';

import { OrgDataResidencySettings } from '@/app/features/settings/org-data-residency/components/org-data-residency-settings';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/data-residency')({
  head: () => ({ meta: seo('orgDataResidency') }),
  component: OrgDataResidencyPage,
});

function OrgDataResidencyPage() {
  const { id: organizationId } = Route.useParams();
  return <OrgDataResidencySettings organizationId={organizationId} />;
}

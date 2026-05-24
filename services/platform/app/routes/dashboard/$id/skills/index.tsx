import { createFileRoute } from '@tanstack/react-router';

import { SkillsTable } from '@/app/features/skills/components/skills-table';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/skills/')({
  head: () => ({
    meta: seo('skills'),
  }),
  component: SkillsPage,
});

function SkillsPage() {
  const { id: organizationId } = Route.useParams();
  return <SkillsTable organizationId={organizationId} />;
}

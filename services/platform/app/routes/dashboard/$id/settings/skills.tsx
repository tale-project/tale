import { createFileRoute } from '@tanstack/react-router';

import { SkillsSettings } from '@/app/features/skills/components/skills-settings';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/skills')({
  head: () => ({ meta: seo('skills') }),
  component: SkillsPage,
});

function SkillsPage() {
  const { id: organizationId } = Route.useParams();
  return <SkillsSettings organizationId={organizationId} />;
}

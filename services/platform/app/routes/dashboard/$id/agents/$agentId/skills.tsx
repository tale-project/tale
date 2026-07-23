import { createFileRoute } from '@tanstack/react-router';

import { AgentSkillsTab } from '@/app/features/agents/components/agent-skills-tab';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/agents/$agentId/skills')({
  head: () => ({
    meta: seo('agentSkills'),
  }),
  component: AgentSkillsPage,
});

function AgentSkillsPage() {
  const { id: organizationId, agentId: slug } = Route.useParams();
  return <AgentSkillsTab organizationId={organizationId} slug={slug} />;
}

import {
  AgentsHeroDemo,
  AgentsTourAutomationsDemo,
  AgentsTourChatDemo,
  AgentsTourKnowledgeDemo,
  AgentsTourProjectsDemo,
} from '@/app/components/blocks/demos/content';
import { FeaturePageLayout } from '@/app/pages/platform/feature-page-layout';
import { useFeaturePageContent } from '@/app/pages/platform/use-feature-page-content';
import { usePlatformTour } from '@/app/pages/platform/use-platform-tour';

export function AgentsPage() {
  const content = useFeaturePageContent('agents', 'platformAgents');
  // Agent-flavored scenes: a library scoped to one agent, a workflow that
  // calls an agent as its LLM step, and a delegation moment in chat.
  const tour = usePlatformTour('platformAgents', [
    { id: 'projects', demo: <AgentsTourProjectsDemo /> },
    { id: 'knowledge', demo: <AgentsTourKnowledgeDemo /> },
    { id: 'automations', demo: <AgentsTourAutomationsDemo /> },
    { id: 'chat', demo: <AgentsTourChatDemo /> },
  ]);

  return (
    <FeaturePageLayout
      content={{
        ...content,
        visual: <AgentsHeroDemo />,
        ...tour,
      }}
    />
  );
}

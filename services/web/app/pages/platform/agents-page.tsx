import {
  AgentsHeroDemo,
  AgentsTourKnowledgeDemo,
  AgentsTourProjectsDemo,
} from '@/app/components/blocks/demos/content';
import { FeaturePageLayout } from '@/app/pages/platform/feature-page-layout';
import { useFeaturePageContent } from '@/app/pages/platform/use-feature-page-content';
import { usePlatformTour } from '@/app/pages/platform/use-platform-tour';

export function AgentsPage() {
  const content = useFeaturePageContent('agents', 'platformAgents');
  // Two focused tours connect agents to its supporting project context.
  const tour = usePlatformTour('platformAgents', [
    { id: 'projects', demo: <AgentsTourProjectsDemo /> },
    { id: 'knowledge', demo: <AgentsTourKnowledgeDemo /> },
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

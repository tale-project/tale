import {
  ChatHeroDemo,
  ChatTourAgentsDemo,
  ChatTourGovernDemo,
  ChatTourKnowledgeDemo,
  ChatTourProjectsDemo,
} from '@/app/components/blocks/demos/content';
import { FeaturePageLayout } from '@/app/pages/platform/feature-page-layout';
import { useFeaturePageContent } from '@/app/pages/platform/use-feature-page-content';
import { usePlatformTour } from '@/app/pages/platform/use-platform-tour';

export function ChatPage() {
  const content = useFeaturePageContent('chat', 'platformChat');
  // Chat leads with the Arena split (its signature scene) on its own story;
  // the tour then shows an in-thread approval, projects, agents, and the
  // libraries grounded replies cite.
  const tour = usePlatformTour('platformChat', [
    { id: 'govern', demo: <ChatTourGovernDemo /> },
    { id: 'projects', demo: <ChatTourProjectsDemo /> },
    { id: 'agents', demo: <ChatTourAgentsDemo /> },
    { id: 'knowledge', demo: <ChatTourKnowledgeDemo /> },
  ]);

  return (
    <FeaturePageLayout
      content={{
        ...content,
        visual: <ChatHeroDemo />,
        ...tour,
      }}
    />
  );
}

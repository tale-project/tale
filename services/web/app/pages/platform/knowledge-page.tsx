import {
  KnowledgeHeroDemo,
  KnowledgeTourAgentsDemo,
  KnowledgeTourArenaDemo,
  KnowledgeTourChatDemo,
  KnowledgeTourProjectsDemo,
} from '@/app/components/blocks/demos/content';
import { FeaturePageLayout } from '@/app/pages/platform/feature-page-layout';
import { useFeaturePageContent } from '@/app/pages/platform/use-feature-page-content';
import { usePlatformTour } from '@/app/pages/platform/use-platform-tour';

export function KnowledgePage() {
  const content = useFeaturePageContent('knowledge', 'platformKnowledge');
  // One library, one story: the hero indexes the product corpus, the chat
  // stage cites those exact sources, and Arena answers from the same shelf.
  const tour = usePlatformTour('platformKnowledge', [
    { id: 'chat', demo: <KnowledgeTourChatDemo /> },
    { id: 'agents', demo: <KnowledgeTourAgentsDemo /> },
    { id: 'arena', demo: <KnowledgeTourArenaDemo /> },
    { id: 'projects', demo: <KnowledgeTourProjectsDemo /> },
  ]);

  return (
    <FeaturePageLayout
      content={{
        ...content,
        visual: <KnowledgeHeroDemo />,
        ...tour,
      }}
    />
  );
}

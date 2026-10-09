import {
  KnowledgeHeroDemo,
  KnowledgeTourChatDemo,
  KnowledgeTourProjectsDemo,
} from '@/app/components/blocks/demos/content';
import { FeaturePageLayout } from '@/app/pages/platform/feature-page-layout';
import { useFeaturePageContent } from '@/app/pages/platform/use-feature-page-content';
import { usePlatformTour } from '@/app/pages/platform/use-platform-tour';

export function KnowledgePage() {
  const content = useFeaturePageContent('knowledge', 'platformKnowledge');
  // Two focused tours connect knowledge to its supporting project context.
  const tour = usePlatformTour('platformKnowledge', [
    { id: 'chat', demo: <KnowledgeTourChatDemo /> },
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

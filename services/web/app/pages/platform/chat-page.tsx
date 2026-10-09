import {
  ChatHeroDemo,
  ChatTourKnowledgeDemo,
  ChatTourProjectsDemo,
} from '@/app/components/blocks/demos/content';
import { FeaturePageLayout } from '@/app/pages/platform/feature-page-layout';
import { useFeaturePageContent } from '@/app/pages/platform/use-feature-page-content';
import { usePlatformTour } from '@/app/pages/platform/use-platform-tour';

export function ChatPage() {
  const content = useFeaturePageContent('chat', 'platformChat');
  // Two focused tours connect chat to its supporting project context.
  const tour = usePlatformTour('platformChat', [
    { id: 'projects', demo: <ChatTourProjectsDemo /> },
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

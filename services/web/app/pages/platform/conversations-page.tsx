import {
  ConversationsHeroDemo,
  ConversationsTourArenaDemo,
  ConversationsTourGovernDemo,
  ConversationsTourKnowledgeDemo,
  ConversationsTourProjectsDemo,
} from '@/app/components/blocks/demos/content';
import { FeaturePageLayout } from '@/app/pages/platform/feature-page-layout';
import { useFeaturePageContent } from '@/app/pages/platform/use-feature-page-content';
import { usePlatformTour } from '@/app/pages/platform/use-platform-tour';

export function ConversationsPage() {
  const content = useFeaturePageContent(
    'conversations',
    'platformConversations',
  );
  // The hero resumes a handed-off thread with its citations intact; the tour
  // compares drafts in Arena, scopes threads by project, and approves actions
  // inside the thread against shared libraries.
  const tour = usePlatformTour('platformConversations', [
    { id: 'arena', demo: <ConversationsTourArenaDemo /> },
    { id: 'projects', demo: <ConversationsTourProjectsDemo /> },
    { id: 'govern', demo: <ConversationsTourGovernDemo /> },
    { id: 'knowledge', demo: <ConversationsTourKnowledgeDemo /> },
  ]);

  return (
    <FeaturePageLayout
      content={{
        ...content,
        visual: <ConversationsHeroDemo />,
        ...tour,
      }}
    />
  );
}

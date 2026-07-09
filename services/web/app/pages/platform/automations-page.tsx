import {
  AutomationsHeroDemo,
  AutomationsTourAgentsDemo,
  AutomationsTourGovernDemo,
  AutomationsTourKnowledgeDemo,
  AutomationsTourProjectsDemo,
} from '@/app/components/blocks/demos/content';
import { FeaturePageLayout } from '@/app/pages/platform/feature-page-layout';
import { useFeaturePageContent } from '@/app/pages/platform/use-feature-page-content';
import { usePlatformTour } from '@/app/pages/platform/use-platform-tour';

export function AutomationsPage() {
  const content = useFeaturePageContent('automations', 'platformAutomations');
  // One invoice pipeline end to end: the hero workflow holds large invoices
  // for approval; the tour approves that gated run and shows the vendor
  // knowledge its LLM steps retrieve from.
  const tour = usePlatformTour('platformAutomations', [
    { id: 'govern', demo: <AutomationsTourGovernDemo /> },
    { id: 'agents', demo: <AutomationsTourAgentsDemo /> },
    { id: 'knowledge', demo: <AutomationsTourKnowledgeDemo /> },
    { id: 'projects', demo: <AutomationsTourProjectsDemo /> },
  ]);

  return (
    <FeaturePageLayout
      content={{
        ...content,
        visual: <AutomationsHeroDemo />,
        ...tour,
      }}
    />
  );
}

import {
  AutomationsHeroDemo,
  AutomationsTourAgentsDemo,
  AutomationsTourGovernDemo,
} from '@/app/components/blocks/demos/content';
import { FeaturePageLayout } from '@/app/pages/platform/feature-page-layout';
import { useFeaturePageContent } from '@/app/pages/platform/use-feature-page-content';
import { usePlatformTour } from '@/app/pages/platform/use-platform-tour';

export function AutomationsPage() {
  const content = useFeaturePageContent('automations', 'platformAutomations');
  // Two focused tours connect automations to its supporting project context.
  const tour = usePlatformTour('platformAutomations', [
    { id: 'govern', demo: <AutomationsTourGovernDemo /> },
    { id: 'agents', demo: <AutomationsTourAgentsDemo /> },
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

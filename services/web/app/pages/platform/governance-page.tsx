import {
  GovernanceHeroDemo,
  GovernanceTourAgentsDemo,
  GovernanceTourAutomationsDemo,
} from '@/app/components/blocks/demos/content';
import { FeaturePageLayout } from '@/app/pages/platform/feature-page-layout';
import { useFeaturePageContent } from '@/app/pages/platform/use-feature-page-content';
import { usePlatformTour } from '@/app/pages/platform/use-platform-tour';

export function GovernancePage() {
  const content = useFeaturePageContent('governance', 'platformGovernance');
  // Two focused tours connect governance to its supporting project context.
  const tour = usePlatformTour('platformGovernance', [
    { id: 'automations', demo: <GovernanceTourAutomationsDemo /> },
    { id: 'agents', demo: <GovernanceTourAgentsDemo /> },
  ]);

  return (
    <FeaturePageLayout
      content={{
        ...content,
        visual: <GovernanceHeroDemo />,
        ...tour,
      }}
    />
  );
}

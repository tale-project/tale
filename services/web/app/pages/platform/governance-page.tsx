import {
  GovernanceHeroDemo,
  GovernanceTourAgentsDemo,
  GovernanceTourArenaDemo,
  GovernanceTourAutomationsDemo,
  GovernanceTourKnowledgeDemo,
} from '@/app/components/blocks/demos/content';
import { FeaturePageLayout } from '@/app/pages/platform/feature-page-layout';
import { useFeaturePageContent } from '@/app/pages/platform/use-feature-page-content';
import { usePlatformTour } from '@/app/pages/platform/use-platform-tour';

export function GovernancePage() {
  const content = useFeaturePageContent('governance', 'platformGovernance');
  // Governance-flavored scenes: a knowledge write held for approval, a
  // nightly access review that leaves a log, a policy-tone Arena duel, and
  // the policy corpus auditors can open.
  const tour = usePlatformTour('platformGovernance', [
    { id: 'automations', demo: <GovernanceTourAutomationsDemo /> },
    { id: 'arena', demo: <GovernanceTourArenaDemo /> },
    { id: 'agents', demo: <GovernanceTourAgentsDemo /> },
    { id: 'knowledge', demo: <GovernanceTourKnowledgeDemo /> },
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

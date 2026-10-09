import { AutomationRun } from '@/app/components/blocks/demos/automation-run';
import { ConnectAgents } from '@/app/components/blocks/demos/connect-agents';
import {
  useAgentsScenario,
  useAutomationScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { ProductScreenshot } from '@/app/components/blocks/product-screenshot';

export function GovernanceHeroDemo() {
  return <ProductScreenshot page="governance" />;
}

export function GovernanceTourAutomationsDemo() {
  const scenario = useAutomationScenario('platformGovernance');
  return <AutomationRun scenario={scenario} />;
}

export function GovernanceTourAgentsDemo() {
  const scenario = useAgentsScenario('platformGovernance');
  return <ConnectAgents scenario={scenario} />;
}

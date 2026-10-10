import { ConnectAgents } from '@/app/components/blocks/demos/connect-agents';
import {
  useAgentsScenario,
  useGovernScenario,
  useProjectsScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { GovernGate } from '@/app/components/blocks/demos/govern-gate';
import { ProjectsBoard } from '@/app/components/blocks/demos/projects-board';
import { ProductScreenshot } from '@/app/components/blocks/product-screenshot';

export function AutomationsHeroDemo() {
  return <ProductScreenshot page="automations" />;
}

export function AutomationsTourGovernDemo() {
  const scenario = useGovernScenario('platformAutomations');
  return <GovernGate scenario={scenario} />;
}

export function AutomationsTourAgentsDemo() {
  const scenario = useAgentsScenario('platformAutomations');
  return <ConnectAgents scenario={scenario} />;
}

export function AutomationsTourProjectsDemo() {
  const scenario = useProjectsScenario('platformAutomations');
  return <ProjectsBoard scenario={scenario} />;
}

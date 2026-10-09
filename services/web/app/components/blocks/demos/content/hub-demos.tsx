import { ConnectAgents } from '@/app/components/blocks/demos/connect-agents';
import {
  useAgentsScenario,
  useProjectsScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { ProjectsBoard } from '@/app/components/blocks/demos/projects-board';
import { ProductScreenshot } from '@/app/components/blocks/product-screenshot';

/** The actual Home screen, captured in the documentation example workspace. */
export function HubHeroDemo() {
  return <ProductScreenshot page="hub" />;
}

export function HubTourAgentsDemo() {
  const scenario = useAgentsScenario('platformHub');
  return <ConnectAgents scenario={scenario} />;
}

export function HubTourProjectsDemo() {
  const scenario = useProjectsScenario('platformHub');
  return <ProjectsBoard scenario={scenario} />;
}

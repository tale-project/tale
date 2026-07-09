import { AutomationRun } from '@/app/components/blocks/demos/automation-run';
import { ConnectAgents } from '@/app/components/blocks/demos/connect-agents';
import {
  useAgentsScenario,
  useAutomationScenario,
  useGovernScenario,
  useKnowledgeScenario,
  useProjectsScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { GovernGate } from '@/app/components/blocks/demos/govern-gate';
import { KnowledgePool } from '@/app/components/blocks/demos/knowledge-pool';
import { ProjectsBoard } from '@/app/components/blocks/demos/projects-board';

export function AutomationsHeroDemo() {
  const scenario = useAutomationScenario('platformAutomations');
  return <AutomationRun scenario={scenario} />;
}

export function AutomationsTourGovernDemo() {
  const scenario = useGovernScenario('platformAutomations');
  return <GovernGate scenario={scenario} />;
}

export function AutomationsTourAgentsDemo() {
  const scenario = useAgentsScenario('platformAutomations');
  return <ConnectAgents scenario={scenario} />;
}

export function AutomationsTourKnowledgeDemo() {
  const scenario = useKnowledgeScenario('platformAutomations');
  return <KnowledgePool scenario={scenario} />;
}

export function AutomationsTourProjectsDemo() {
  const scenario = useProjectsScenario('platformAutomations');
  return <ProjectsBoard scenario={scenario} />;
}

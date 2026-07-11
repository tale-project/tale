import { AutomationRun } from '@/app/components/blocks/demos/automation-run';
import { ConnectAgents } from '@/app/components/blocks/demos/connect-agents';
import {
  useAgentsScenario,
  useAutomationScenario,
  useKnowledgeScenario,
  useProjectsScenario,
  useSandboxScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { KnowledgePool } from '@/app/components/blocks/demos/knowledge-pool';
import { ProjectsBoard } from '@/app/components/blocks/demos/projects-board';
import { SandboxWorkspace } from '@/app/components/blocks/demos/sandbox-workspace';

export function AgentsHeroDemo() {
  const scenario = useAgentsScenario('platformAgents');
  return <ConnectAgents scenario={scenario} />;
}

export function AgentsTourProjectsDemo() {
  const scenario = useProjectsScenario('platformAgents');
  return <ProjectsBoard scenario={scenario} />;
}

export function AgentsTourKnowledgeDemo() {
  const scenario = useKnowledgeScenario('platformAgents');
  return <KnowledgePool scenario={scenario} />;
}

export function AgentsTourAutomationsDemo() {
  const scenario = useAutomationScenario('platformAgents');
  return <AutomationRun scenario={scenario} />;
}

export function AgentsTourChatDemo() {
  const scenario = useSandboxScenario('platformAgents');
  return <SandboxWorkspace scenario={scenario} />;
}

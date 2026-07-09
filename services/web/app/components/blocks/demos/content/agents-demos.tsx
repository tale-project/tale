import { AutomationRun } from '@/app/components/blocks/demos/automation-run';
import { ConnectAgents } from '@/app/components/blocks/demos/connect-agents';
import {
  useAgentsScenario,
  useAutomationScenario,
  useChatScenario,
  useKnowledgeScenario,
  useProjectsScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { HeroOrchestration } from '@/app/components/blocks/demos/hero-orchestration';
import { KnowledgePool } from '@/app/components/blocks/demos/knowledge-pool';
import { ProjectsBoard } from '@/app/components/blocks/demos/projects-board';

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
  const scenario = useChatScenario('platformAgents');
  return <HeroOrchestration scenario={scenario} elevation="default" />;
}

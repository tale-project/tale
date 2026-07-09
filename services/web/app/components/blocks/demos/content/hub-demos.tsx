import { AutomationRun } from '@/app/components/blocks/demos/automation-run';
import { ChatArena } from '@/app/components/blocks/demos/chat-arena';
import { ConnectAgents } from '@/app/components/blocks/demos/connect-agents';
import {
  useAgentsScenario,
  useArenaScenario,
  useAutomationScenario,
  useChatScenario,
  useGovernScenario,
  useKnowledgeScenario,
  useProjectsScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { GovernGate } from '@/app/components/blocks/demos/govern-gate';
import { HeroOrchestration } from '@/app/components/blocks/demos/hero-orchestration';
import { KnowledgePool } from '@/app/components/blocks/demos/knowledge-pool';
import { ProjectsBoard } from '@/app/components/blocks/demos/projects-board';

/** Platform hub hero — overview chat owned by the hub namespace. */
export function HubHeroDemo() {
  const scenario = useChatScenario('platformHub');
  return <HeroOrchestration scenario={scenario} />;
}

export function HubTourAgentsDemo() {
  const scenario = useAgentsScenario('platformHub');
  return <ConnectAgents scenario={scenario} />;
}

export function HubTourKnowledgeDemo() {
  const scenario = useKnowledgeScenario('platformHub');
  return <KnowledgePool scenario={scenario} />;
}

export function HubTourAutomationsDemo() {
  const scenario = useAutomationScenario('platformHub');
  return <AutomationRun scenario={scenario} />;
}

export function HubTourGovernDemo() {
  const scenario = useGovernScenario('platformHub');
  return <GovernGate scenario={scenario} />;
}

export function HubTourArenaDemo() {
  const scenario = useArenaScenario('platformHub');
  return <ChatArena scenario={scenario} />;
}

export function HubTourProjectsDemo() {
  const scenario = useProjectsScenario('platformHub');
  return <ProjectsBoard scenario={scenario} />;
}

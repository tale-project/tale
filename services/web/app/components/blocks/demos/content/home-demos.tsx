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

/** Homepage hero — support-escalation chat on the full-bleed stage. */
export function HomeHeroDemo() {
  const scenario = useChatScenario('home');
  return <HeroOrchestration scenario={scenario} elevation="hero" />;
}

export function HomeConnectDemo() {
  const scenario = useAgentsScenario('home');
  return <ConnectAgents scenario={scenario} />;
}

export function HomeKnowledgeDemo() {
  const scenario = useKnowledgeScenario('home');
  return <KnowledgePool scenario={scenario} />;
}

export function HomeAutomationDemo() {
  const scenario = useAutomationScenario('home');
  return <AutomationRun scenario={scenario} />;
}

export function HomeGovernDemo() {
  const scenario = useGovernScenario('home');
  return <GovernGate scenario={scenario} />;
}

export function HomeArenaDemo() {
  const scenario = useArenaScenario('home');
  return <ChatArena scenario={scenario} />;
}

export function HomeProjectsDemo() {
  const scenario = useProjectsScenario('home');
  return <ProjectsBoard scenario={scenario} />;
}

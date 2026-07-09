import { ChatArena } from '@/app/components/blocks/demos/chat-arena';
import { ConnectAgents } from '@/app/components/blocks/demos/connect-agents';
import {
  useAgentsScenario,
  useArenaScenario,
  useGovernScenario,
  useKnowledgeScenario,
  useProjectsScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { GovernGate } from '@/app/components/blocks/demos/govern-gate';
import { KnowledgePool } from '@/app/components/blocks/demos/knowledge-pool';
import { ProjectsBoard } from '@/app/components/blocks/demos/projects-board';

export function ChatHeroDemo() {
  const scenario = useArenaScenario('platformChat');
  return <ChatArena scenario={scenario} />;
}

export function ChatTourGovernDemo() {
  const scenario = useGovernScenario('platformChat');
  return <GovernGate scenario={scenario} />;
}

export function ChatTourProjectsDemo() {
  const scenario = useProjectsScenario('platformChat');
  return <ProjectsBoard scenario={scenario} />;
}

export function ChatTourAgentsDemo() {
  const scenario = useAgentsScenario('platformChat');
  return <ConnectAgents scenario={scenario} />;
}

export function ChatTourKnowledgeDemo() {
  const scenario = useKnowledgeScenario('platformChat');
  return <KnowledgePool scenario={scenario} />;
}

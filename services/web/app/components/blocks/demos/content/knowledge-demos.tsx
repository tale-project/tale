import { ChatArena } from '@/app/components/blocks/demos/chat-arena';
import { ConnectAgents } from '@/app/components/blocks/demos/connect-agents';
import {
  useAgentsScenario,
  useArenaScenario,
  useChatScenario,
  useKnowledgeScenario,
  useProjectsScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { HeroOrchestration } from '@/app/components/blocks/demos/hero-orchestration';
import { KnowledgePool } from '@/app/components/blocks/demos/knowledge-pool';
import { ProjectsBoard } from '@/app/components/blocks/demos/projects-board';

export function KnowledgeHeroDemo() {
  const scenario = useKnowledgeScenario('platformKnowledge');
  return <KnowledgePool scenario={scenario} />;
}

export function KnowledgeTourChatDemo() {
  const scenario = useChatScenario('platformKnowledge');
  return <HeroOrchestration scenario={scenario} elevation="default" />;
}

export function KnowledgeTourAgentsDemo() {
  const scenario = useAgentsScenario('platformKnowledge');
  return <ConnectAgents scenario={scenario} />;
}

export function KnowledgeTourArenaDemo() {
  const scenario = useArenaScenario('platformKnowledge');
  return <ChatArena scenario={scenario} />;
}

export function KnowledgeTourProjectsDemo() {
  const scenario = useProjectsScenario('platformKnowledge');
  return <ProjectsBoard scenario={scenario} />;
}

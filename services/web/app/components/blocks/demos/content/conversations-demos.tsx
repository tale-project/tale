import { ChatArena } from '@/app/components/blocks/demos/chat-arena';
import {
  useArenaScenario,
  useChatScenario,
  useGovernScenario,
  useKnowledgeScenario,
  useProjectsScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { GovernGate } from '@/app/components/blocks/demos/govern-gate';
import { HeroOrchestration } from '@/app/components/blocks/demos/hero-orchestration';
import { KnowledgePool } from '@/app/components/blocks/demos/knowledge-pool';
import { ProjectsBoard } from '@/app/components/blocks/demos/projects-board';

export function ConversationsHeroDemo() {
  const scenario = useChatScenario('platformConversations');
  return <HeroOrchestration scenario={scenario} />;
}

export function ConversationsTourArenaDemo() {
  const scenario = useArenaScenario('platformConversations');
  return <ChatArena scenario={scenario} />;
}

export function ConversationsTourProjectsDemo() {
  const scenario = useProjectsScenario('platformConversations');
  return <ProjectsBoard scenario={scenario} />;
}

export function ConversationsTourGovernDemo() {
  const scenario = useGovernScenario('platformConversations');
  return <GovernGate scenario={scenario} />;
}

export function ConversationsTourKnowledgeDemo() {
  const scenario = useKnowledgeScenario('platformConversations');
  return <KnowledgePool scenario={scenario} />;
}

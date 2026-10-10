import {
  useChatScenario,
  useProjectsScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { HeroOrchestration } from '@/app/components/blocks/demos/hero-orchestration';
import { ProjectsBoard } from '@/app/components/blocks/demos/projects-board';
import { ProductScreenshot } from '@/app/components/blocks/product-screenshot';

export function KnowledgeHeroDemo() {
  return <ProductScreenshot page="knowledge" />;
}

export function KnowledgeTourChatDemo() {
  const scenario = useChatScenario('platformKnowledge');
  return <HeroOrchestration scenario={scenario} elevation="default" />;
}

export function KnowledgeTourProjectsDemo() {
  const scenario = useProjectsScenario('platformKnowledge');
  return <ProjectsBoard scenario={scenario} />;
}

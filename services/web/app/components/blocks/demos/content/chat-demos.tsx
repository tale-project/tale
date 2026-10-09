import {
  useKnowledgeScenario,
  useProjectsScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { KnowledgePool } from '@/app/components/blocks/demos/knowledge-pool';
import { ProjectsBoard } from '@/app/components/blocks/demos/projects-board';
import { ProductScreenshot } from '@/app/components/blocks/product-screenshot';

export function ChatHeroDemo() {
  return <ProductScreenshot page="chat" />;
}

export function ChatTourProjectsDemo() {
  const scenario = useProjectsScenario('platformChat');
  return <ProjectsBoard scenario={scenario} />;
}

export function ChatTourKnowledgeDemo() {
  const scenario = useKnowledgeScenario('platformChat');
  return <KnowledgePool scenario={scenario} />;
}

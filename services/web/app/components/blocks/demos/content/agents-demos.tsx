import {
  useKnowledgeScenario,
  useProjectsScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { KnowledgePool } from '@/app/components/blocks/demos/knowledge-pool';
import { ProjectsBoard } from '@/app/components/blocks/demos/projects-board';
import { ProductScreenshot } from '@/app/components/blocks/product-screenshot';

export function AgentsHeroDemo() {
  return <ProductScreenshot page="agents" />;
}

export function AgentsTourProjectsDemo() {
  const scenario = useProjectsScenario('platformAgents');
  return <ProjectsBoard scenario={scenario} />;
}

export function AgentsTourKnowledgeDemo() {
  const scenario = useKnowledgeScenario('platformAgents');
  return <KnowledgePool scenario={scenario} />;
}

import {
  useChatScenario,
  useGovernScenario,
  useTaskBoardScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { GovernGate } from '@/app/components/blocks/demos/govern-gate';
import { HeroOrchestration } from '@/app/components/blocks/demos/hero-orchestration';
import { TaskBoard } from '@/app/components/blocks/demos/task-board';
import { ProductScreenshot } from '@/app/components/blocks/product-screenshot';

export function ProjectsHeroDemo() {
  return <ProductScreenshot page="projects" />;
}

export function ProjectsTourTasksDemo() {
  const scenario = useTaskBoardScenario('platformProjects');
  return <TaskBoard scenario={scenario} />;
}

export function ProjectsTourChatDemo() {
  const scenario = useChatScenario('platformProjects');
  return <HeroOrchestration scenario={scenario} elevation="default" />;
}

export function ProjectsTourGovernDemo() {
  const scenario = useGovernScenario('platformProjects');
  return <GovernGate scenario={scenario} />;
}

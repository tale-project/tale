import {
  useChatScenario,
  useGovernScenario,
  useKnowledgeScenario,
  useProjectsScenario,
  useTaskBoardScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { GovernGate } from '@/app/components/blocks/demos/govern-gate';
import { HeroOrchestration } from '@/app/components/blocks/demos/hero-orchestration';
import { KnowledgePool } from '@/app/components/blocks/demos/knowledge-pool';
import { ProjectsBoard } from '@/app/components/blocks/demos/projects-board';
import { TaskBoard } from '@/app/components/blocks/demos/task-board';

export function ProjectsHeroDemo() {
  const scenario = useProjectsScenario('platformProjects');
  return <ProjectsBoard scenario={scenario} />;
}

export function ProjectsTourTasksDemo() {
  const scenario = useTaskBoardScenario('platformProjects');
  return <TaskBoard scenario={scenario} />;
}

export function ProjectsTourChatDemo() {
  const scenario = useChatScenario('platformProjects');
  return <HeroOrchestration scenario={scenario} elevation="default" />;
}

export function ProjectsTourKnowledgeDemo() {
  const scenario = useKnowledgeScenario('platformProjects');
  return <KnowledgePool scenario={scenario} />;
}

export function ProjectsTourGovernDemo() {
  const scenario = useGovernScenario('platformProjects');
  return <GovernGate scenario={scenario} />;
}

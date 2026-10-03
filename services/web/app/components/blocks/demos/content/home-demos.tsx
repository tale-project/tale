import {
  useGovernScenario,
  useProjectsScenario,
  useTaskBoardScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { GovernGate } from '@/app/components/blocks/demos/govern-gate';
import { ProjectsBoard } from '@/app/components/blocks/demos/projects-board';
import { TaskBoard } from '@/app/components/blocks/demos/task-board';

/** Homepage hero — shared project tasks beside the introduction. */
export function HomeHeroDemo() {
  const scenario = useTaskBoardScenario('home');
  return <TaskBoard scenario={scenario} elevation="hero" />;
}

export function HomeGovernDemo() {
  const scenario = useGovernScenario('home');
  return <GovernGate scenario={scenario} />;
}

export function HomeProjectsDemo() {
  const scenario = useProjectsScenario('home');
  return <ProjectsBoard scenario={scenario} />;
}

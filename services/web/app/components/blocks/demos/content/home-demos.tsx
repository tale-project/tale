import { useProjectsScenario } from '@/app/components/blocks/demos/demo-scenarios';
import { ProjectsBoard } from '@/app/components/blocks/demos/projects-board';

export function HomeProjectsDemo() {
  const scenario = useProjectsScenario('home');
  return <ProjectsBoard scenario={scenario} />;
}

import { AutomationRun } from '@/app/components/blocks/demos/automation-run';
import {
  useAutomationScenario,
  useChatScenario,
  useGovernScenario,
  useKnowledgeScenario,
  useProjectsScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { GovernGate } from '@/app/components/blocks/demos/govern-gate';
import { HeroOrchestration } from '@/app/components/blocks/demos/hero-orchestration';
import { KnowledgePool } from '@/app/components/blocks/demos/knowledge-pool';
import { ProjectsBoard } from '@/app/components/blocks/demos/projects-board';

export function ProjectsHeroDemo() {
  const scenario = useProjectsScenario('platformProjects');
  return <ProjectsBoard scenario={scenario} />;
}

export function ProjectsTourTasksDemo() {
  const scenario = useAutomationScenario('platformProjects');
  return <AutomationRun scenario={scenario} />;
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

import {
  ProjectsHeroDemo,
  ProjectsTourChatDemo,
  ProjectsTourGovernDemo,
  ProjectsTourKnowledgeDemo,
  ProjectsTourTasksDemo,
} from '@/app/components/blocks/demos/content';
import { FeaturePageLayout } from '@/app/pages/platform/feature-page-layout';
import { useFeaturePageContent } from '@/app/pages/platform/use-feature-page-content';
import { usePlatformTour } from '@/app/pages/platform/use-platform-tour';

export function ProjectsPage() {
  const content = useFeaturePageContent('projects', 'platformProjects');
  // The hero shows the workspace roster; the tour assigns a board task to an
  // agent, resumes a project chat with its context, opens the project files,
  // and holds the outbound step behind a review gate.
  const tour = usePlatformTour('platformProjects', [
    { id: 'tasks', demo: <ProjectsTourTasksDemo /> },
    { id: 'chat', demo: <ProjectsTourChatDemo /> },
    { id: 'knowledge', demo: <ProjectsTourKnowledgeDemo /> },
    { id: 'govern', demo: <ProjectsTourGovernDemo /> },
  ]);

  return (
    <FeaturePageLayout
      content={{
        ...content,
        visual: <ProjectsHeroDemo />,
        ...tour,
      }}
    />
  );
}

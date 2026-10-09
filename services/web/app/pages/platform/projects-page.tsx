import {
  ProjectsHeroDemo,
  ProjectsTourChatDemo,
  ProjectsTourTasksDemo,
} from '@/app/components/blocks/demos/content';
import { FeaturePageLayout } from '@/app/pages/platform/feature-page-layout';
import { useFeaturePageContent } from '@/app/pages/platform/use-feature-page-content';
import { usePlatformTour } from '@/app/pages/platform/use-platform-tour';

export function ProjectsPage() {
  const content = useFeaturePageContent('projects', 'platformProjects');
  // Two focused tours connect projects to its supporting project context.
  const tour = usePlatformTour('platformProjects', [
    { id: 'tasks', demo: <ProjectsTourTasksDemo /> },
    { id: 'chat', demo: <ProjectsTourChatDemo /> },
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

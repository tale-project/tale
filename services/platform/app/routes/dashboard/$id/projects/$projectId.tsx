import { Heading } from '@tale/ui/heading';
import { Skeleton } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { ContentArea } from '@/app/components/layout/content-area';
import { PageLayout } from '@/app/components/layout/page-layout';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { ProjectAvatar } from '@/app/features/projects/components/project-avatar';
import { useProject } from '@/app/features/projects/hooks/queries';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

export const Route = createFileRoute('/dashboard/$id/projects/$projectId')({
  component: ProjectDetailLayout,
});

function ProjectDetailLayout() {
  const { id: organizationId, projectId } = Route.useParams();
  const { t } = useT('projects');
  const { t: tCommon } = useT('common');

  const { project, isLoading } = useProject(asProjectId(projectId));

  const tabs: TabNavigationItem[] = [
    {
      label: t('navigation.overview'),
      href: `/dashboard/${organizationId}/projects/${projectId}`,
      matchMode: 'exact',
    },
    {
      label: t('navigation.files'),
      href: `/dashboard/${organizationId}/projects/${projectId}/files`,
      matchMode: 'exact',
    },
    {
      label: t('navigation.instructions'),
      href: `/dashboard/${organizationId}/projects/${projectId}/instructions`,
      matchMode: 'exact',
    },
    {
      label: t('navigation.threads'),
      href: `/dashboard/${organizationId}/projects/${projectId}/threads`,
      matchMode: 'exact',
    },
    {
      label: t('navigation.agents'),
      href: `/dashboard/${organizationId}/projects/${projectId}/agents`,
      matchMode: 'exact',
    },
    {
      label: t('navigation.settings'),
      href: `/dashboard/${organizationId}/projects/${projectId}/settings`,
      matchMode: 'exact',
    },
  ];

  if (isLoading) {
    return (
      <PageLayout
        header={
          <>
            <AdaptiveHeaderRoot standalone={false} className="gap-2">
              <Heading level={1} size="base" truncate>
                <Link
                  to="/dashboard/$id/projects"
                  params={{ id: organizationId }}
                  className="text-muted-foreground hidden md:inline"
                >
                  {t('title')}&nbsp;&nbsp;
                </Link>
                <span className="hidden md:inline">/&nbsp;&nbsp;</span>
                <Skeleton className="inline-block h-4 w-32 align-middle" />
              </Heading>
            </AdaptiveHeaderRoot>
            <TabNavigation
              items={tabs}
              standalone={false}
              ariaLabel={tCommon('aria.projectsNavigation', {
                defaultValue: 'Projects navigation',
              })}
            />
          </>
        }
      >
        <ContentArea variant="narrow" className="py-4">
          <Skeleton className="h-8 w-full" />
        </ContentArea>
      </PageLayout>
    );
  }

  if (!project) {
    return (
      <PageLayout>
        <ContentArea variant="narrow" className="py-6">
          <Text variant="muted">{t('errors.PROJECT_NOT_FOUND')}</Text>
        </ContentArea>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      header={
        <>
          <AdaptiveHeaderRoot standalone={false} className="gap-2">
            <Heading level={1} size="base" truncate>
              <Link
                to="/dashboard/$id/projects"
                params={{ id: organizationId }}
                className={cn(
                  'hidden md:inline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                  'text-muted-foreground cursor-pointer',
                )}
              >
                {t('title')}&nbsp;&nbsp;
              </Link>
              <span className="text-foreground inline-flex items-center gap-2">
                <span className="hidden md:inline">/&nbsp;</span>
                <ProjectAvatar
                  name={project.name}
                  icon={project.icon}
                  color={project.color}
                  size={20}
                />
                {project.name}
              </span>
            </Heading>
          </AdaptiveHeaderRoot>
          <TabNavigation
            items={tabs}
            standalone={false}
            ariaLabel={tCommon('aria.projectsNavigation', {
              defaultValue: 'Projects navigation',
            })}
          />
        </>
      }
    >
      <Outlet />
    </PageLayout>
  );
}

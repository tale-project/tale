'use client';

import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { Stack, HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link, useNavigate } from '@tanstack/react-router';

import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  useProject,
  useProjectStats,
  useProjectThreads,
} from '../hooks/queries';
import { ProjectAvatar } from './project-avatar';

interface ProjectOverviewProps {
  organizationId: string;
  projectId: Id<'projects'>;
}

export function ProjectOverview({
  organizationId,
  projectId,
}: ProjectOverviewProps) {
  const { t } = useT('projects');
  const navigate = useNavigate();
  const { project } = useProject(projectId);
  const { stats } = useProjectStats(projectId);
  const { threads } = useProjectThreads(projectId, 'all');

  if (!project) return null;

  const recentThreads = threads
    .slice()
    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
    .slice(0, 5);

  const handleNewChat = () => {
    void navigate({
      to: '/dashboard/$id/chat',
      params: { id: organizationId },
      search: { projectId: String(projectId) } as Record<string, string>,
    });
  };

  const teamCount =
    (project.teamId ? 1 : 0) + (project.sharedWithTeamIds?.length ?? 0);

  return (
    <Stack gap={6} className="p-6">
      <HStack gap={4} align="start" className="flex-wrap">
        <ProjectAvatar
          name={project.name}
          icon={project.icon}
          color={project.color}
          size={32}
        />
        <Stack gap={1} className="min-w-0 flex-1">
          <Heading level={1} size="lg">
            {project.name}
          </Heading>
          {project.description ? (
            <Text variant="muted">{project.description}</Text>
          ) : null}
        </Stack>
        <Button onClick={handleNewChat}>{t('overview.newChatCta')}</Button>
      </HStack>

      {/* Stats + sharing */}
      <HStack gap={4} className="flex-wrap">
        <div className="border-border min-w-[12rem] flex-1 rounded-md border p-4">
          <Text variant="caption" className="mb-2 uppercase">
            {t('overview.statsHeading')}
          </Text>
          <Stack gap={1}>
            <Text>
              {t('overview.statsFiles', { count: stats?.fileCount ?? 0 })}
            </Text>
            {stats?.indexedFileCount ? (
              <Text variant="muted" className="text-xs">
                {t('overview.statsIndexed', {
                  count: stats.indexedFileCount,
                })}
              </Text>
            ) : null}
            <Text>
              {t('overview.statsChats', { count: stats?.threadCount ?? 0 })}
            </Text>
            {stats?.sharedThreadCount ? (
              <Text variant="muted" className="text-xs">
                {t('overview.statsShared', {
                  count: stats.sharedThreadCount,
                })}
              </Text>
            ) : null}
          </Stack>
        </div>
        <div className="border-border min-w-[12rem] flex-1 rounded-md border p-4">
          <Text variant="caption" className="mb-2 uppercase">
            {t('overview.sharingHeading')}
          </Text>
          {teamCount === 0 ? (
            <Text variant="muted">{t('list.sharingOrgWide')}</Text>
          ) : (
            <Text variant="muted">
              {t('list.sharingMultipleTeams', { count: teamCount })}
            </Text>
          )}
        </div>
      </HStack>

      {/* Instructions excerpt */}
      <div className="border-border rounded-md border p-4">
        <Text variant="caption" className="mb-2 uppercase">
          {t('overview.instructionsExcerpt')}
        </Text>
        {project.instructions ? (
          <Text className="line-clamp-4 whitespace-pre-wrap">
            {project.instructions}
          </Text>
        ) : (
          <Text variant="muted">{t('overview.instructionsExcerptEmpty')}</Text>
        )}
        {project.canEdit ? (
          <div className="mt-3">
            <Link
              to="/dashboard/$id/projects/$projectId/instructions"
              params={{
                id: organizationId,
                projectId: String(projectId),
              }}
              className="text-primary text-sm hover:underline"
            >
              {t('overview.instructionsExcerptEdit')}
            </Link>
          </div>
        ) : null}
      </div>

      {/* Recent chats */}
      <div className="border-border rounded-md border p-4">
        <HStack justify="between" align="center" className="mb-3">
          <Text variant="caption" className="uppercase">
            {t('overview.recentChats')}
          </Text>
          {threads.length > 5 ? (
            <Link
              to="/dashboard/$id/projects/$projectId/threads"
              params={{
                id: organizationId,
                projectId: String(projectId),
              }}
              className="text-primary text-xs hover:underline"
            >
              {t('overview.recentChatsViewAll')}
            </Link>
          ) : null}
        </HStack>
        {recentThreads.length === 0 ? (
          <Text variant="muted">{t('overview.recentChatsEmpty')}</Text>
        ) : (
          <Stack gap={2}>
            {recentThreads.map((thread) => (
              <Link
                key={thread._id}
                to="/dashboard/$id/chat/$threadId"
                params={{
                  id: organizationId,
                  threadId: thread.threadId,
                }}
                className="hover:bg-muted/50 -mx-2 flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors"
              >
                <span className="min-w-0 flex-1 truncate">
                  {thread.title ?? thread.threadId}
                </span>
                {thread.sharedWithProject ? (
                  <span className="bg-muted rounded px-2 py-0.5 text-xs">
                    {t('threads.sharedWithProject')}
                  </span>
                ) : null}
              </Link>
            ))}
          </Stack>
        )}
      </div>
    </Stack>
  );
}

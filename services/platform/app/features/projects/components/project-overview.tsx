'use client';

import { Button } from '@tale/ui/button';
import { PageSection } from '@tale/ui/page-section';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Text } from '@tale/ui/text';
import { Link, useNavigate } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import { useCallback, useMemo } from 'react';
import { z } from 'zod/v4';

import { ContentArea } from '@/app/components/layout/content-area';
import {
  useFormEditor,
  useRegisterActiveEditor,
} from '@/app/components/ui/editor';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import {
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
} from '@/lib/shared/schemas/projects';

import { useUpdateProjectIdentity } from '../hooks/mutations';
import {
  useProject,
  useProjectStats,
  useProjectThreads,
} from '../hooks/queries';
import { ProjectArchivedBadge } from './project-archived-badge';
import { ProjectReadOnlyBanner } from './project-read-only-banner';
import { ProjectSharingSection } from './project-sharing-section';

interface ProjectOverviewProps {
  organizationId: string;
  projectId: Id<'projects'>;
}

type IdentityForm = {
  name: string;
  description: string;
};

const PROJECT_OVERVIEW_FORM_ID = 'project-overview-identity-form';

export function ProjectOverview({
  organizationId,
  projectId,
}: ProjectOverviewProps) {
  const { t } = useT('projects');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const { project } = useProject(projectId);
  const { stats } = useProjectStats(projectId);
  const { threads } = useProjectThreads(projectId, 'all');
  const { mutateAsync: updateIdentity } = useUpdateProjectIdentity();

  const identitySchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(
            1,
            tCommon('validation.required', {
              field: t('settings.name'),
            }),
          )
          .max(PROJECT_NAME_MAX, t('errors.PROJECT_NAME_INVALID')),
        description: z.string().trim().max(PROJECT_DESCRIPTION_MAX),
      }),
    [t, tCommon],
  );

  const data = useMemo<IdentityForm | undefined>(
    () =>
      project
        ? {
            name: project.name,
            description: project.description ?? '',
          }
        : undefined,
    [project],
  );

  const save = useCallback(
    async (values: IdentityForm) => {
      try {
        await updateIdentity({
          projectId,
          name: values.name,
          description:
            values.description.trim().length > 0 ? values.description : null,
        });
        toast({ title: t('settings.saveSuccess'), variant: 'success' });
      } catch (error) {
        if (error instanceof ConvexError) {
          const code = error.data?.code;
          if (code === 'PROJECT_NAME_INVALID') {
            toast({
              title: t('errors.PROJECT_NAME_INVALID'),
              variant: 'destructive',
            });
            throw error;
          }
          if (code === 'PROJECT_DESCRIPTION_INVALID') {
            toast({
              title: t('errors.PROJECT_DESCRIPTION_INVALID'),
              variant: 'destructive',
            });
            throw error;
          }
        }
        console.error('updateProjectIdentity failed', error);
        toast({ title: t('settings.saveError'), variant: 'destructive' });
        throw error;
      }
    },
    [projectId, t, updateIdentity],
  );

  const editor = useFormEditor<IdentityForm>({
    data,
    schema: identitySchema,
    save,
  });

  // Hand this controller to the project layout's tab-strip Save/Discard
  // cluster so identity edits are saved from the single page-level action
  // location, not a per-section save button.
  useRegisterActiveEditor(editor);

  const {
    form: {
      register,
      formState: { errors },
    },
  } = editor;

  const recentThreads = useMemo(
    () =>
      threads
        .slice()
        .sort(
          (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
        )
        .slice(0, 5),
    [threads],
  );

  const teamCount = project
    ? (project.teamId ? 1 : 0) + (project.sharedWithTeamIds?.length ?? 0)
    : 0;

  // Inline "stats" string (e.g. "12 files · 5 chats · Org-wide") for the
  // page header. Computed before the project null-guard so the hook order
  // stays stable; the empty-stats fallback returns undefined.
  //
  // The chat count is read off the same `threads` list the Recent-chats
  // section below renders from (`listProjectThreads`, visible member-facing
  // chats only) rather than `stats.threadCount` (`getProjectStats`, an
  // unfiltered count of every threadMetadata row for the project — including
  // hidden task-comment threads and other members' unshared chats) —
  // otherwise the two disagree on the same page (#2648).
  const statsLine = useMemo(() => {
    if (!stats) return undefined;
    const parts: string[] = [];
    parts.push(
      t('overview.statsFiles', { count: stats.fileCount }) +
        (stats.truncated ? '+' : ''),
    );
    parts.push(t('overview.statsChats', { count: threads.length }));
    if (teamCount === 0) {
      parts.push(t('list.sharingOrgWide'));
    } else {
      parts.push(t('list.sharingMultipleTeams', { count: teamCount }));
    }
    return parts.join(' · ');
  }, [stats, teamCount, t, threads.length]);

  if (!project) return null;

  const canEdit = project.canEdit;
  const canAdminister = project.canAdminister;
  const isViewerOnly = !canEdit && !canAdminister;

  const handleNewChat = () => {
    void navigate({
      to: '/dashboard/$id/chat',
      params: { id: organizationId },
      search: { projectId: String(projectId) },
    });
  };

  return (
    <ContentArea variant="narrow" gap={6}>
      {isViewerOnly ? <ProjectReadOnlyBanner /> : null}

      {/* Sticky header — project name + archived badge as title, inline
          stats + sharing summary as description, "New chat" as the only
          action. Save/Discard for the identity form live in the project
          layout's tab strip (registered via useRegisterActiveEditor). */}
      <StickySectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            {project.name}
            {project.archivedAt ? <ProjectArchivedBadge /> : null}
          </span>
        }
        description={statsLine}
        action={
          <Button onClick={handleNewChat}>{t('overview.newChatCta')}</Button>
        }
      />

      {/* Identity — inline edit when canEdit, read-only summary otherwise.
          Wrapped in a PageSection so the title + divider match the rest
          of the platform's settings pages. */}
      {canEdit ? (
        <PageSection
          title={t('settings.identity')}
          description={t('overview.identityDescription')}
          gap={4}
        >
          <form id={PROJECT_OVERVIEW_FORM_ID} onSubmit={editor.submit}>
            <fieldset
              disabled={editor.isLoading || editor.isSaving}
              className="contents"
            >
              <FormSection>
                <Input
                  id="project-overview-name"
                  label={t('settings.name')}
                  {...register('name')}
                  maxLength={PROJECT_NAME_MAX}
                  errorMessage={errors.name?.message}
                />
                <Textarea
                  id="project-overview-description"
                  label={t('settings.description')}
                  rows={2}
                  maxLength={PROJECT_DESCRIPTION_MAX}
                  {...register('description')}
                  errorMessage={errors.description?.message}
                />
              </FormSection>
            </fieldset>
          </form>
        </PageSection>
      ) : project.description ? (
        <PageSection title={t('settings.identity')} gap={3}>
          <Text variant="muted">{project.description}</Text>
        </PageSection>
      ) : null}

      {/* Empty-project nudge — locales shipped these keys unused. Show only
          while files and chats are both still empty so it doesn't linger. */}
      {canEdit &&
      stats != null &&
      stats.fileCount === 0 &&
      threads.length === 0 ? (
        <PageSection
          title={t('overview.getStartedHeading')}
          gap={3}
          className="mt-8 border-t pt-8"
        >
          <ul
            role="list"
            className="divide-border border-border divide-y overflow-hidden rounded-lg border"
          >
            <li>
              <Link
                to="/dashboard/$id/projects/$projectId/files"
                params={{
                  id: organizationId,
                  projectId: String(projectId),
                }}
                className="hover:bg-muted/50 flex flex-col gap-0.5 px-4 py-3 transition-colors"
              >
                <span className="text-sm font-medium">
                  {t('overview.getStartedFilesTitle')}
                </span>
                <span className="text-muted-foreground text-sm">
                  {t('overview.getStartedFilesBody')}
                </span>
              </Link>
            </li>
            <li>
              <Link
                to="/dashboard/$id/projects/$projectId/instructions"
                params={{
                  id: organizationId,
                  projectId: String(projectId),
                }}
                className="hover:bg-muted/50 flex flex-col gap-0.5 px-4 py-3 transition-colors"
              >
                <span className="text-sm font-medium">
                  {t('overview.getStartedInstructionsTitle')}
                </span>
                <span className="text-muted-foreground text-sm">
                  {t('overview.getStartedInstructionsBody')}
                </span>
              </Link>
            </li>
            <li>
              <a
                href="#project-sharing"
                className="hover:bg-muted/50 flex flex-col gap-0.5 px-4 py-3 transition-colors"
              >
                <span className="text-sm font-medium">
                  {t('overview.getStartedShareTitle')}
                </span>
                <span className="text-muted-foreground text-sm">
                  {t('overview.getStartedShareBody')}
                </span>
              </a>
            </li>
          </ul>
        </PageSection>
      ) : null}

      <PageSection
        id="project-sharing"
        title={t('overview.sharingHeading')}
        gap={4}
        className="mt-8 border-t pt-8"
      >
        <ProjectSharingSection
          projectId={projectId}
          organizationId={organizationId}
          teamId={project.teamId}
          sharedWithTeamIds={project.sharedWithTeamIds ?? []}
          canAdminister={canAdminister}
        />
      </PageSection>

      <PageSection
        title={t('overview.recentChats')}
        action={
          threads.length > 5 ? (
            <Link
              to="/dashboard/$id/projects/$projectId/threads"
              params={{
                id: organizationId,
                projectId: String(projectId),
              }}
              className="text-primary text-sm hover:underline"
            >
              {t('overview.recentChatsViewAll')}
            </Link>
          ) : undefined
        }
        gap={3}
        className="mt-8 border-t pt-8"
      >
        {recentThreads.length === 0 ? (
          <Text variant="muted">{t('overview.recentChatsEmpty')}</Text>
        ) : (
          <div className="divide-y rounded-lg border">
            {recentThreads.map((thread) => (
              <Link
                key={thread._id}
                to="/dashboard/$id/chat/$threadId"
                params={{
                  id: organizationId,
                  threadId: thread.threadId,
                }}
                className="hover:bg-muted/50 flex items-center gap-2 px-4 py-3 text-sm transition-colors"
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
          </div>
        )}
      </PageSection>
    </ContentArea>
  );
}

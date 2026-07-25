'use client';

import { Button } from '@tale/ui/button';
import { PageSection } from '@tale/ui/page-section';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import { useCallback, useMemo } from 'react';
import { z } from 'zod/v4';

import { ContentArea } from '@/app/components/layout/content-area';
import {
  EditorGroup,
  useFormEditor,
  useRegisterGroupedEditor,
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
import { ProjectInstructionsEditor } from './project-instructions-editor';
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

/**
 * The project's general page. Two independently-editable sections live here —
 * identity and the standing instructions — so the page owns an `EditorGroup`
 * that composes both into the single Save/Discard cluster the project layout's
 * tab strip renders.
 */
export function ProjectOverview(props: ProjectOverviewProps) {
  return (
    <EditorGroup>
      <ProjectOverviewContent {...props} />
    </EditorGroup>
  );
}

function ProjectOverviewContent({
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

  // Hand this controller to the page's editor group, which composes it with
  // the instructions section below into the ONE Save/Discard cluster the
  // project layout's tab strip shows — not a per-section save button.
  useRegisterGroupedEditor(editor);

  const {
    form: {
      register,
      formState: { errors },
    },
  } = editor;

  const teamCount = project
    ? (project.teamId ? 1 : 0) + (project.sharedWithTeamIds?.length ?? 0)
    : 0;

  // Inline "stats" string (e.g. "12 files · 5 chats · Org-wide") for the
  // page header. Computed before the project null-guard so the hook order
  // stays stable; the empty-stats fallback returns undefined.
  //
  // The chat count reads the visible member-facing list (`listProjectThreads`)
  // rather than `stats.threadCount` (`getProjectStats`, an unfiltered count of
  // every threadMetadata row for the project — including hidden task-comment
  // threads and other members' unshared chats), so the header never claims
  // chats a member cannot see (#2648).
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
          action. Save/Discard for this page's sections live in the project
          layout's tab strip (composed by the EditorGroup above). */}
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

      {/* The project's standing instructions — a property of the project, so
          they sit with identity here instead of on a tab of their own. */}
      <ProjectInstructionsEditor projectId={projectId} />

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
    </ContentArea>
  );
}

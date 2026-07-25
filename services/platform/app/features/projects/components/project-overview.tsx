'use client';

import { PageSection } from '@tale/ui/page-section';
import { Text } from '@tale/ui/text';
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
import { useProject } from '../hooks/queries';
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
  const { project } = useProject(projectId);
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

  if (!project) return null;

  const canEdit = project.canEdit;
  const canAdminister = project.canAdminister;
  const isViewerOnly = !canEdit && !canAdminister;

  return (
    <ContentArea variant="narrow" gap={6}>
      {isViewerOnly ? <ProjectReadOnlyBanner /> : null}

      {/* The project's basics — inline edit when canEdit, read-only summary
          otherwise. The layout's header already names the project, so this
          page opens directly with the section. Save/Discard for its editors
          live in the project layout's tab strip (composed by the EditorGroup
          above). */}
      {canEdit ? (
        <PageSection
          title={t('overview.projectSection')}
          description={t('overview.projectSectionDescription')}
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
                  description={t('settings.nameHint')}
                  {...register('name')}
                  maxLength={PROJECT_NAME_MAX}
                  errorMessage={errors.name?.message}
                />
                <Textarea
                  id="project-overview-description"
                  label={t('settings.description')}
                  description={t('settings.descriptionHint')}
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
        <PageSection title={t('overview.projectSection')} gap={3}>
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

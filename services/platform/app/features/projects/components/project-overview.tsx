'use client';

import { Text } from '@tale/ui/text';
import { useCallback, useMemo } from 'react';
import { z } from 'zod/v4';

import { ContentArea } from '@/app/components/layout/content-area';
import {
  EditorGroup,
  useFormEditor,
  useRegisterGroupedEditor,
} from '@/app/components/ui/editor';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SECTION_DIVIDER_CLASS } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import {
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
} from '@/lib/shared/schemas/projects';
import { convexErrorCode } from '@/lib/utils/convex-error';

import { useUpdateProjectIdentity } from '../hooks/mutations';
import { useProject } from '../hooks/queries';
import { ProjectDangerZone } from './project-danger-zone';
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
 * The input a rejected identity update belongs to, or undefined when the
 * failure isn't about one field. The two are shown in different places: a
 * field rejection renders under its own input, anything else becomes the one
 * destructive toast the save cluster raises.
 */
function identityErrorField(error: unknown): keyof IdentityForm | undefined {
  switch (convexErrorCode(error)) {
    case 'PROJECT_NAME_INVALID':
      return 'name';
    case 'PROJECT_DESCRIPTION_INVALID':
      return 'description';
    default:
      return undefined;
  }
}

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

  // Save feedback belongs to the grouped `EditorActions` cluster in the project
  // layout's tab strip: it flashes "Saved" on success and raises the single
  // destructive toast on failure. So this only persists — a rejection that
  // belongs to one of the inputs travels on untouched for `mapServerError` to
  // place under that input, and every other failure becomes the translated line
  // the cluster shows.
  const save = useCallback(
    async (values: IdentityForm) => {
      try {
        await updateIdentity({
          projectId,
          name: values.name,
          description:
            values.description.trim().length > 0 ? values.description : null,
        });
      } catch (error) {
        if (identityErrorField(error)) throw error;
        console.error('updateProjectIdentity failed', error);
        throw new Error(t('settings.saveError'), { cause: error });
      }
    },
    [projectId, t, updateIdentity],
  );

  // A name or description the server refused belongs under its own input, not
  // in a toast — returning issues here routes them through `form.setError` and
  // suppresses the toast entirely.
  const mapServerError = useCallback(
    (error: unknown) => {
      const field = identityErrorField(error);
      if (field === 'name') {
        return [{ path: field, message: t('errors.PROJECT_NAME_INVALID') }];
      }
      if (field === 'description') {
        return [
          { path: field, message: t('errors.PROJECT_DESCRIPTION_INVALID') },
        ];
      }
      return null;
    },
    [t],
  );

  const editor = useFormEditor<IdentityForm>({
    data,
    schema: identitySchema,
    save,
    mapServerError,
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
    // This page is a configuration surface built from `SettingsSection`, so it
    // carries the shared section-divider rule instead of hand-rolled borders on
    // individual sections: the rule keys on each section's marker, which is
    // what draws exactly one hairline between each pair of neighbours —
    // Project, Instructions, Sharing — and nothing after the last one.
    <ContentArea variant="narrow" gap={6} className={SECTION_DIVIDER_CLASS}>
      {isViewerOnly ? <ProjectReadOnlyBanner /> : null}

      {/* The project's basics — inline edit when canEdit, read-only summary
          otherwise. The layout's header already names the project, so this
          page opens directly with the section. Save/Discard for its editors
          live in the project layout's tab strip (composed by the EditorGroup
          above). */}
      {canEdit ? (
        <SettingsSection
          title={t('overview.projectSection')}
          description={t('overview.projectSectionDescription')}
        >
          {/* Submit through the controller, never `form.handleSubmit(save)`:
              that second path would skip the dirty-baseline reset and the
              server-error mapping the tab strip's Save button gets. */}
          <form id={PROJECT_OVERVIEW_FORM_ID} onSubmit={editor.submit}>
            <fieldset
              disabled={editor.isLoading || editor.isSaving}
              className="contents"
            >
              {/* The shared settings-field list: each field is a row with its
                  label + helper text on the left and its control pinned right
                  in the same fixed-width column, divided from its neighbour, so
                  the two read as one block with their controls aligned. */}
              <SettingsFieldList>
                <SettingsFieldRow
                  label={t('settings.name')}
                  description={t('settings.nameHint')}
                  required
                >
                  {/* The row owns the label, so the control carries its
                      accessible name itself. `wrapperClassName="w-full"` lets
                      the bare Input fill the row's control column so its
                      skeleton mask matches the loaded width. */}
                  <Input
                    id="project-overview-name"
                    aria-label={t('settings.name')}
                    required
                    maxLength={PROJECT_NAME_MAX}
                    errorMessage={errors.name?.message}
                    {...register('name')}
                    wrapperClassName="w-full"
                  />
                </SettingsFieldRow>

                <SettingsFieldRow
                  label={t('settings.description')}
                  description={t('settings.descriptionHint')}
                >
                  <Textarea
                    id="project-overview-description"
                    aria-label={t('settings.description')}
                    rows={2}
                    maxLength={PROJECT_DESCRIPTION_MAX}
                    errorMessage={errors.description?.message}
                    {...register('description')}
                  />
                </SettingsFieldRow>
              </SettingsFieldList>
            </fieldset>
          </form>
        </SettingsSection>
      ) : project.description ? (
        <SettingsSection title={t('overview.projectSection')}>
          <Text variant="muted">{project.description}</Text>
        </SettingsSection>
      ) : null}

      {/* The project's standing instructions — a property of the project, so
          they sit with identity here instead of on a tab of their own. */}
      <ProjectInstructionsEditor projectId={projectId} />

      <SettingsSection
        id="project-sharing"
        title={t('overview.sharingHeading')}
      >
        <ProjectSharingSection
          projectId={projectId}
          organizationId={organizationId}
          teamId={project.teamId}
          sharedWithTeamIds={project.sharedWithTeamIds ?? []}
          canAdminister={canAdminister}
        />
      </SettingsSection>

      {/* Archive and delete live HERE — the chat sidebar's folder menu and
          the projects list both point at this one guarded home. */}
      {canAdminister ? (
        <ProjectDangerZone
          organizationId={organizationId}
          projectId={projectId}
          projectName={project.name}
          isArchived={project.archivedAt !== undefined}
        />
      ) : null}
    </ContentArea>
  );
}

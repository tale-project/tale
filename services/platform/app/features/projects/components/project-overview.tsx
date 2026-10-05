'use client';

import {
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
  projectColorSchema,
  projectIconSchema,
} from '@tale/shared/schemas/projects';
import { ContentArea } from '@tale/ui/content-area';
import {
  EditorGroup,
  useFormEditor,
  useRegisterGroupedEditor,
} from '@tale/ui/editor';
import { Input } from '@tale/ui/input';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { useCallback, useMemo } from 'react';
import { z } from 'zod/v4';

import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SECTION_DIVIDER_CLASS } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useT } from '@/lib/i18n/client';
import { backendErrorCode } from '@/lib/utils/backend-error';

import { useUpdateProjectIdentity } from '../hooks/mutations';
import { useProject } from '../hooks/queries';
import { ProjectArchiveSection } from './project-archive-section';
import { ProjectDangerZone } from './project-danger-zone';
import { ProjectIdentityPicker } from './project-identity-picker';
import { ProjectInstructionsEditor } from './project-instructions-editor';
import { ProjectReadError } from './project-read-error';
import { ProjectReadOnlyBanner } from './project-read-only-banner';
import { ProjectSharingSection } from './project-sharing-section';
import { ProjectTaskReviewerSection } from './project-task-reviewer-section';

interface ProjectOverviewProps {
  organizationId: string;
  projectId: string;
}

type IdentityForm = {
  name: string;
  description: string;
  /** `null` = the default folder / gray — what a fresh project carries. */
  icon: string | null;
  color: string | null;
};

const PROJECT_OVERVIEW_FORM_ID = 'project-overview-identity-form';

/**
 * The input a rejected identity update belongs to, or undefined when the
 * failure isn't about one field. The two are shown in different places: a
 * field rejection renders under its own input, anything else becomes the one
 * destructive toast the save cluster raises.
 */
function identityErrorField(error: unknown): keyof IdentityForm | undefined {
  switch (backendErrorCode(error)) {
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
  const projectRead = useProject(projectId);
  const { project } = projectRead;
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
        icon: projectIconSchema.nullable(),
        color: projectColorSchema.nullable(),
      }),
    [t, tCommon],
  );

  const data = useMemo<IdentityForm | undefined>(
    () =>
      project
        ? {
            name: project.name,
            description: project.description ?? '',
            icon: project.icon ?? null,
            color: project.color ?? null,
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
          icon: values.icon,
          color: values.color,
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
      setValue,
      watch,
      formState: { errors },
    },
  } = editor;

  // The icon/color pair has no native input to `register`, so the picker
  // writes through `setValue` with `shouldDirty` — that is what lets the tab
  // strip's Save cluster wake up and Discard restore the saved pair.
  const iconValue = watch('icon');
  const colorValue = watch('color');

  if (!project) {
    // The project shell answers both states before this page mounts; on its
    // own, the page still says what happened rather than going blank
    // (#3885): a read that failed, with Try again, or a project the read
    // answered as gone. Its first read stays under the shell's skeleton.
    if (projectRead.unavailable) return <ProjectReadError read={projectRead} />;
    if (projectRead.isLoading) return null;
    return (
      <ContentArea variant="narrow" className="py-6">
        <Text variant="muted">{t('errors.PROJECT_NOT_FOUND')}</Text>
      </ContentArea>
    );
  }

  // An archived project is read-only for everyone (the backend drops
  // `canEdit` with it) — only Restore, in the Archive section below, and
  // Delete stay, for administrators.
  const isArchived = project.archivedAt !== undefined;
  const canEdit = project.canEdit && !isArchived;
  const canAdminister = project.canAdminister;
  const isViewerOnly = !canEdit && !canAdminister;

  return (
    // This page is a configuration surface built from `SettingsSection`, so it
    // carries the shared section-divider rule instead of hand-rolled borders on
    // individual sections: the rule keys on each section's marker, which is
    // what draws exactly one hairline between each pair of neighbours —
    // Project, Instructions, Sharing — and nothing after the last one.
    <ContentArea variant="narrow" gap={6} className={SECTION_DIVIDER_CLASS}>
      {isArchived ? (
        <ProjectReadOnlyBanner reason="archived" />
      ) : isViewerOnly ? (
        <ProjectReadOnlyBanner />
      ) : null}

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
                  {/* The row owns the label and the hint, so the control
                      points at both for its accessible name and description.
                      `wrapperClassName="w-full"` lets the bare Input fill the
                      row's control column so its skeleton mask matches the
                      loaded width. */}
                  {({ labelId, descriptionId }) => (
                    <Input
                      id="project-overview-name"
                      aria-labelledby={labelId}
                      aria-describedby={descriptionId}
                      required
                      maxLength={PROJECT_NAME_MAX}
                      errorMessage={errors.name?.message}
                      {...register('name')}
                      wrapperClassName="w-full"
                    />
                  )}
                </SettingsFieldRow>

                <SettingsFieldRow
                  label={t('settings.description')}
                  description={t('settings.descriptionHint')}
                >
                  {({ labelId, descriptionId }) => (
                    <Textarea
                      id="project-overview-description"
                      aria-labelledby={labelId}
                      aria-describedby={descriptionId}
                      rows={2}
                      maxLength={PROJECT_DESCRIPTION_MAX}
                      errorMessage={errors.description?.message}
                      {...register('description')}
                    />
                  )}
                </SettingsFieldRow>

                <SettingsFieldRow
                  label={t('identity.label')}
                  description={t('identity.hint')}
                  className="@xl/field-layout:items-center"
                >
                  <ProjectIdentityPicker
                    name={project.name}
                    value={{
                      icon: iconValue ?? null,
                      color: colorValue ?? null,
                    }}
                    onChange={(next) => {
                      setValue('icon', next.icon, { shouldDirty: true });
                      setValue('color', next.color, { shouldDirty: true });
                    }}
                    disabled={editor.isLoading || editor.isSaving}
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

      <ProjectTaskReviewerSection projectId={projectId} />

      <SettingsSection
        id="project-sharing"
        title={t('overview.sharingHeading')}
      >
        <ProjectSharingSection
          projectId={projectId}
          organizationId={organizationId}
          teamIds={
            project.teamIds ?? [
              ...(project.teamId ? [project.teamId] : []),
              ...(project.sharedWithTeamIds ?? []),
            ]
          }
          canAdminister={canAdminister && !isArchived}
        />
      </SettingsSection>

      {/* Archive (reversible) lives above the danger zone — it's a shelf, not
          a destructive action. Delete (irreversible) stays in the red zone
          below. The chat sidebar's folder menu deep-links to the danger zone
          id, so both sections remain at this one guarded home. */}
      {canAdminister ? (
        <ProjectArchiveSection
          projectId={projectId}
          projectName={project.name}
          isArchived={project.archivedAt !== undefined}
        />
      ) : null}

      {canAdminister ? (
        <ProjectDangerZone
          organizationId={organizationId}
          projectId={projectId}
          projectName={project.name}
        />
      ) : null}
    </ContentArea>
  );
}

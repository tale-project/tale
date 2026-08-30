'use client';

import { Text } from '@tale/ui/text';
import { useCallback, useMemo } from 'react';

import {
  useFormEditor,
  useRegisterGroupedEditor,
} from '@/app/components/ui/editor';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { BackendError } from '@/app/lib/backend/backend-error';
import { useT } from '@/lib/i18n/client';
import { PROJECT_INSTRUCTIONS_MAX_CHARS } from '@/lib/shared/schemas/projects';
import { cn } from '@/lib/utils/cn';

import { useUpdateProjectInstructions } from '../hooks/mutations';
import { useProject } from '../hooks/queries';

interface ProjectInstructionsEditorProps {
  projectId: string;
}

interface InstructionsForm {
  instructions: string;
}

const FORM_ID = 'project-instructions-form';

/**
 * The project's standing instructions — a titled section of the project's
 * general page: a property of the project like its name, so it lives here
 * rather than on a tab of its own. Saving runs through the page's grouped
 * Save/Discard cluster, together with the identity form.
 */
export function ProjectInstructionsEditor({
  projectId,
}: ProjectInstructionsEditorProps) {
  const { t } = useT('projects');
  const { project } = useProject(projectId);
  const { mutateAsync: updateInstructions } = useUpdateProjectInstructions();

  const data = useMemo<InstructionsForm | undefined>(
    () => (project ? { instructions: project.instructions ?? '' } : undefined),
    [project],
  );

  const canEdit = project?.canEdit ?? false;

  const save = useCallback(
    async ({ instructions }: InstructionsForm) => {
      try {
        await updateInstructions({ projectId, instructions });
      } catch (error) {
        // The over-limit rejection is rethrown untouched so `mapServerError`
        // can pin it under the field; anything else surfaces as the cluster's
        // one generic save toast.
        if (
          error instanceof BackendError &&
          error.data?.code === 'PROJECT_INSTRUCTIONS_TOO_LONG'
        ) {
          throw error;
        }
        console.error('updateProjectInstructions failed', error);
        throw new Error(t('settings.saveError'), { cause: error });
      }
    },
    [projectId, t, updateInstructions],
  );

  const mapServerError = useCallback(
    (error: unknown) => {
      if (
        error instanceof BackendError &&
        error.data?.code === 'PROJECT_INSTRUCTIONS_TOO_LONG'
      ) {
        return [
          {
            path: 'instructions',
            message: t('errors.PROJECT_INSTRUCTIONS_TOO_LONG', {
              cap: PROJECT_INSTRUCTIONS_MAX_CHARS,
            }),
          },
        ];
      }
      return null;
    },
    [t],
  );

  const editor = useFormEditor<InstructionsForm>({
    data,
    save,
    mapServerError,
  });

  const value = editor.form.watch('instructions') ?? '';
  const charCount = value.length;
  const overLimit = charCount > PROJECT_INSTRUCTIONS_MAX_CHARS;
  const nearLimit =
    charCount > PROJECT_INSTRUCTIONS_MAX_CHARS * 0.8 && !overLimit;

  // Join the page's single Save/Discard cluster alongside the identity form.
  // An over-limit draft blocks the group's save, which is right — the write
  // would be refused anyway.
  useRegisterGroupedEditor({
    ...editor,
    isValid: !overLimit && editor.isValid,
  });

  if (!project) return null;

  // A settings section like Project and Sharing around it: the section header
  // carries the label + hint (so the textarea only needs an accessible name),
  // and the shared marker-driven divider rule draws the hairline above it.
  return (
    <form id={FORM_ID} onSubmit={editor.submit}>
      <fieldset disabled={!canEdit || editor.isLoading} className="contents">
        <SettingsSection
          title={t('instructions.label')}
          description={t('instructions.hint')}
        >
          <FormSection>
            <Textarea
              id="project-instructions"
              aria-label={t('instructions.label')}
              placeholder={t('instructions.placeholder')}
              rows={12}
              // The section IS this one control: span the full row instead of
              // the 20rem control column the page's row layout would pin an
              // (unlabelled) field to.
              wideControl
              {...editor.form.register('instructions')}
              errorMessage={editor.form.formState.errors.instructions?.message}
            />
            <Text
              variant="caption"
              className={cn(
                overLimit && 'text-destructive',
                nearLimit && 'text-amber-600',
              )}
            >
              {t('instructions.charCount', {
                count: charCount,
                max: PROJECT_INSTRUCTIONS_MAX_CHARS,
              })}
              {overLimit
                ? ' — ' +
                  t('instructions.tokenCapError', {
                    cap: PROJECT_INSTRUCTIONS_MAX_CHARS,
                  })
                : nearLimit
                  ? ' — ' +
                    t('instructions.tokenCapWarning', {
                      cap: PROJECT_INSTRUCTIONS_MAX_CHARS,
                    })
                  : ''}
            </Text>
          </FormSection>
        </SettingsSection>
      </fieldset>
    </form>
  );
}

'use client';

import { PageSection } from '@tale/ui/page-section';
import { Text } from '@tale/ui/text';
import { ConvexError } from 'convex/values';
import { useCallback, useMemo } from 'react';

import {
  useFormEditor,
  useRegisterGroupedEditor,
} from '@/app/components/ui/editor';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { PROJECT_INSTRUCTIONS_MAX_CHARS } from '@/lib/shared/schemas/projects';
import { cn } from '@/lib/utils/cn';

import { useUpdateProjectInstructions } from '../hooks/mutations';
import { useProject } from '../hooks/queries';

interface ProjectInstructionsEditorProps {
  projectId: Id<'projects'>;
}

interface InstructionsForm {
  instructions: string;
}

const FORM_ID = 'project-instructions-form';

/**
 * The project's standing instructions, as one section of the project's general
 * page — they sit with the project's other identity-level settings rather than
 * on a tab of their own, because they are a property of the project, not a
 * place to navigate to. Saving runs through the page's grouped Save/Discard
 * cluster, together with the identity form.
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
        if (error instanceof ConvexError) {
          const code = error.data?.code;
          if (code === 'PROJECT_INSTRUCTIONS_TOO_LONG') {
            toast({
              title: t('errors.PROJECT_INSTRUCTIONS_TOO_LONG', {
                cap: PROJECT_INSTRUCTIONS_MAX_CHARS,
              }),
              variant: 'destructive',
            });
          }
        } else {
          console.error('updateProjectInstructions failed', error);
        }
        throw error;
      }
    },
    [projectId, t, updateInstructions],
  );

  const editor = useFormEditor<InstructionsForm>({
    data,
    save,
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

  return (
    <PageSection
      title={t('instructions.label')}
      description={t('instructions.placeholder')}
      gap={4}
    >
      <form id={FORM_ID} onSubmit={editor.submit}>
        <fieldset disabled={!canEdit || editor.isLoading} className="contents">
          <FormSection>
            <Textarea
              id="project-instructions"
              label={t('instructions.label')}
              placeholder={t('instructions.placeholder')}
              rows={12}
              {...editor.form.register('instructions')}
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
        </fieldset>
      </form>
    </PageSection>
  );
}

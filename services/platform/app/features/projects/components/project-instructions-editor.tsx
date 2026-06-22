'use client';

import { Row } from '@tale/ui/layout';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Text } from '@tale/ui/text';
import { ConvexError } from 'convex/values';
import { useCallback, useMemo, useRef } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import {
  useFormEditor,
  useRegisterActiveEditor,
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

export function ProjectInstructionsEditor({
  projectId,
}: ProjectInstructionsEditorProps) {
  const { t } = useT('projects');
  const { project } = useProject(projectId);
  const { mutateAsync: updateInstructions } = useUpdateProjectInstructions();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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

  // Surface this editor's controller to the project layout's tab-strip
  // Save/Discard cluster. The cluster swaps in/out as the user switches
  // between Overview/Instructions tabs.
  useRegisterActiveEditor({
    ...editor,
    isValid: !overLimit && editor.isValid,
  });

  if (!project) return null;

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('instructions.label')}
        description={t('instructions.placeholder')}
      />

      <form
        id={FORM_ID}
        onSubmit={editor.form.handleSubmit((values) => save(values))}
      >
        <fieldset disabled={!canEdit || editor.isLoading} className="contents">
          <FormSection>
            {(() => {
              // Merge the local ref with RHF's `register('instructions').ref`
              // so we keep both (focus-suppress sync via textareaRef + RHF's
              // internal field binding). Plain spread would overwrite our
              // ref because `register(...).ref` is its own property.
              const reg = editor.form.register('instructions');
              return (
                <Textarea
                  id="project-instructions"
                  label={t('instructions.label')}
                  placeholder={t('instructions.placeholder')}
                  rows={16}
                  {...reg}
                  ref={(node: HTMLTextAreaElement | null) => {
                    reg.ref(node);
                    textareaRef.current = node;
                  }}
                />
              );
            })()}
            <Row gap={0} justify="between">
              <Text
                variant="caption"
                className={cn(
                  overLimit && 'text-destructive',
                  nearLimit && 'text-amber-600',
                )}
              >
                {charCount} / {PROJECT_INSTRUCTIONS_MAX_CHARS}{' '}
                {t('instructions.tokenCountSuffix')}
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
            </Row>
          </FormSection>
        </fieldset>
      </form>
    </ContentArea>
  );
}

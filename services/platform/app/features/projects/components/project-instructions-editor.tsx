'use client';

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ConvexError } from 'convex/values';
import { useCallback, useEffect, useState } from 'react';

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

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function ProjectInstructionsEditor({
  projectId,
}: ProjectInstructionsEditorProps) {
  const { t } = useT('projects');
  const { project } = useProject(projectId);
  const { mutateAsync: updateInstructions } = useUpdateProjectInstructions();

  const [value, setValue] = useState(project?.instructions ?? '');
  const [saveState, setSaveState] = useState<SaveState>('idle');

  // Sync local state when project changes
  useEffect(() => {
    setValue(project?.instructions ?? '');
  }, [project?.instructions]);

  const canEdit = project?.canEdit ?? false;
  const charCount = value.length;
  const overLimit = charCount > PROJECT_INSTRUCTIONS_MAX_CHARS;
  const nearLimit =
    charCount > PROJECT_INSTRUCTIONS_MAX_CHARS * 0.8 && !overLimit;

  const handleBlur = useCallback(async () => {
    if (!canEdit || overLimit) return;
    if (value === (project?.instructions ?? '')) return;
    setSaveState('saving');
    try {
      await updateInstructions({ projectId, instructions: value });
      setSaveState('saved');
      window.setTimeout(() => setSaveState('idle'), 2000);
    } catch (error) {
      setSaveState('error');
      if (error instanceof ConvexError) {
        const code = error.data?.code;
        if (code === 'PROJECT_INSTRUCTIONS_TOO_LONG') {
          toast({
            title: t('errors.PROJECT_INSTRUCTIONS_TOO_LONG', {
              cap: PROJECT_INSTRUCTIONS_MAX_CHARS,
            }),
            variant: 'destructive',
          });
          return;
        }
      }
      console.error('updateProjectInstructions failed', error);
      toast({
        title: t('instructions.saveError'),
        variant: 'destructive',
      });
    }
  }, [
    canEdit,
    overLimit,
    value,
    project?.instructions,
    updateInstructions,
    projectId,
    t,
  ]);

  if (!project) return null;

  return (
    <Stack gap={2} className="p-6">
      <Textarea
        id="project-instructions"
        label={t('instructions.label')}
        placeholder={t('instructions.placeholder')}
        rows={16}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        disabled={!canEdit}
      />
      <div className="flex items-center justify-between">
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
        {saveState === 'saving' ? (
          <Text variant="caption" className="text-muted-foreground">
            {t('instructions.savingIndicator')}
          </Text>
        ) : saveState === 'saved' ? (
          <Text variant="caption" className="text-emerald-600">
            ✓ {t('instructions.savedIndicator')}
          </Text>
        ) : null}
      </div>
    </Stack>
  );
}

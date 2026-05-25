'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ConvexError } from 'convex/values';
import { useEffect, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useWriteSkillAsset } from '../hooks/mutations';
import { useReadSkillAsset } from '../hooks/queries';

interface SkillAssetEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  skillSlug: string;
  /** When set, edit mode — path is fixed and current content is loaded. */
  assetPath: string | null;
}

export function SkillAssetEditorDialog({
  open,
  onOpenChange,
  organizationId,
  skillSlug,
  assetPath,
}: SkillAssetEditorDialogProps) {
  const { t } = useT('settings');
  const queryClient = useQueryClient();
  const { mutateAsync: writeAsset } = useWriteSkillAsset();

  const isEditMode = assetPath !== null;
  const [pathInput, setPathInput] = useState('');
  const [content, setContent] = useState('');
  const [pathError, setPathError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [loadedHash, setLoadedHash] = useState<string | undefined>(undefined);

  const { data: assetData } = useReadSkillAsset(
    organizationId,
    skillSlug,
    isEditMode ? assetPath : null,
  );

  // Sync editor state with the loaded asset when editing.
  useEffect(() => {
    if (!isEditMode) {
      if (!open) {
        setPathInput('');
        setContent('');
        setLoadedHash(undefined);
        setPathError(undefined);
      }
      return;
    }
    if (assetData?.ok) {
      setPathInput(assetPath);
      setContent(assetData.content);
      setLoadedHash(assetData.hash);
    }
  }, [assetData, assetPath, isEditMode, open]);

  const handleSave = async () => {
    if (isSaving) return;
    const targetPath = isEditMode ? assetPath : pathInput.trim();
    if (!targetPath) {
      setPathError(
        t('skills.asset.pathRequired', { defaultValue: 'Path is required' }),
      );
      return;
    }
    setPathError(undefined);
    setIsSaving(true);
    try {
      await writeAsset({
        organizationId,
        slug: skillSlug,
        assetPath: targetPath,
        content,
        ...(loadedHash !== undefined && { expectedHash: loadedHash }),
      });
      toast({
        title: t('skills.asset.saved', { defaultValue: 'File saved' }),
        variant: 'success',
      });
      void queryClient.invalidateQueries({
        queryKey: ['config', 'skills', organizationId, skillSlug],
      });
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ConvexError) {
        const code = error.data?.code;
        if (code === 'CONFLICT') {
          toast({
            title: t('skills.asset.conflict', {
              defaultValue:
                'This file was edited elsewhere. Reopen to see the latest version.',
            }),
            variant: 'destructive',
          });
          return;
        }
        if (
          code === 'BUNDLE_TOO_MANY_FILES' ||
          code === 'BUNDLE_TOO_LARGE' ||
          code === 'TOO_LARGE'
        ) {
          toast({
            title:
              error.data?.message ??
              t('skills.asset.sizeError', {
                defaultValue: 'File would exceed the bundle size limit',
              }),
            variant: 'destructive',
          });
          return;
        }
        if (code === 'NOT_FOUND') {
          toast({
            title: t('skills.asset.notFound', {
              defaultValue: 'Skill not found',
            }),
            variant: 'destructive',
          });
          return;
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      // Path-traversal / invalid path errors arrive as Error not ConvexError.
      if (
        message.includes('Asset path') ||
        message.includes('Path traversal')
      ) {
        setPathError(message);
        return;
      }
      console.error(error);
      toast({
        title: t('skills.asset.saveFailed', {
          defaultValue: 'Failed to save file',
        }),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        isEditMode
          ? t('skills.asset.editTitle', {
              defaultValue: 'Edit {{path}}',
              path: assetPath ?? '',
            })
          : t('skills.asset.createTitle', { defaultValue: 'New bundle file' })
      }
      submitText={t('common.save', { defaultValue: 'Save' })}
      submittingText={t('common.saving', { defaultValue: 'Saving…' })}
      isSubmitting={isSaving}
      onSubmit={() => void handleSave()}
    >
      <Stack gap={4}>
        {!isEditMode ? (
          <>
            <Input
              id="asset-path"
              label={t('skills.asset.path', { defaultValue: 'Path' })}
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder="scripts/run.py"
              errorMessage={pathError}
            />
            <Text variant="caption" className="-mt-2">
              {t('skills.asset.pathHelp', {
                defaultValue:
                  'Relative path within the skill bundle. Use scripts/ for executables, references/ for docs, assets/ for templates.',
              })}
            </Text>
          </>
        ) : (
          <Input
            id="asset-path"
            label={t('skills.asset.path', { defaultValue: 'Path' })}
            value={pathInput}
            readOnly
          />
        )}
        <Textarea
          id="asset-content"
          label={t('skills.asset.content', { defaultValue: 'Content' })}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={18}
          className="font-mono text-sm"
        />
      </Stack>
    </FormDialog>
  );
}

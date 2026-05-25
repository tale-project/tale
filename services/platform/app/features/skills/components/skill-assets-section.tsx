'use client';

import { Button } from '@tale/ui/button';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { formatBytes } from '@/lib/utils/format-bytes';

import { useDeleteSkillAsset } from '../hooks/mutations';
import { SkillAssetEditorDialog } from './skill-asset-editor-dialog';

interface SkillAssetsSectionProps {
  organizationId: string;
  skillSlug: string;
  assets: Array<{ path: string; size: number }>;
  totalBytes: number;
  maxTotalBytes: number;
  maxAssets: number;
}

export function SkillAssetsSection({
  organizationId,
  skillSlug,
  assets,
  totalBytes,
  maxTotalBytes,
  maxAssets,
}: SkillAssetsSectionProps) {
  const { t } = useT('settings');
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const { mutateAsync: deleteAsset } = useDeleteSkillAsset();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const openCreate = useCallback(() => {
    setEditingPath(null);
    setEditorOpen(true);
  }, []);

  const openEdit = useCallback((path: string) => {
    setEditingPath(path);
    setEditorOpen(true);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteAsset({
        organizationId,
        slug: skillSlug,
        assetPath: deleteTarget,
      });
      toast({
        title: t('skills.asset.deleted', { defaultValue: 'File deleted' }),
      });
      void queryClient.invalidateQueries({
        queryKey: ['config', 'skills', organizationId, skillSlug],
      });
      setDeleteTarget(null);
    } catch (error) {
      console.error(error);
      toast({
        title: t('skills.asset.deleteFailed', {
          defaultValue: 'Failed to delete file',
        }),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  }, [
    deleteTarget,
    isDeleting,
    deleteAsset,
    organizationId,
    skillSlug,
    t,
    queryClient,
  ]);

  const atFileLimit = assets.length >= maxAssets;
  const atByteLimit = totalBytes >= maxTotalBytes;

  return (
    <Stack gap={3}>
      <HStack gap={2} align="center" justify="between">
        <Text variant="caption">
          {t('skills.asset.quota', {
            defaultValue: '{used} / {max} files · {bytes} / {byteMax} bytes',
            used: assets.length,
            max: maxAssets,
            bytes: totalBytes,
            byteMax: maxTotalBytes,
          })}
        </Text>
        <Button
          variant="secondary"
          size="sm"
          icon={Plus}
          onClick={openCreate}
          disabled={atFileLimit || atByteLimit}
        >
          {t('skills.asset.add', { defaultValue: 'Add file' })}
        </Button>
      </HStack>

      {assets.length === 0 ? (
        <Text variant="muted">
          {t('skills.bundle.empty', {
            defaultValue: 'No bundle files yet.',
          })}
        </Text>
      ) : (
        <Stack gap={1} className="border-border rounded-md border p-2">
          {assets.map((f) => (
            <HStack
              key={f.path}
              gap={2}
              align="center"
              justify="between"
              className="px-2 py-1.5"
            >
              <Stack gap={1}>
                <Text as="span" variant="body" className="font-mono text-sm">
                  {f.path}
                </Text>
                <Text as="span" variant="caption">
                  {formatBytes(f.size, locale)}
                </Text>
              </Stack>
              <HStack gap={1}>
                <Button
                  variant="ghost"
                  size="icon"
                  icon={Pencil}
                  onClick={() => openEdit(f.path)}
                  aria-label={t('skills.asset.editAria', {
                    defaultValue: 'Edit {path}',
                    path: f.path,
                  })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  icon={Trash2}
                  onClick={() => setDeleteTarget(f.path)}
                  aria-label={t('skills.asset.deleteAria', {
                    defaultValue: 'Delete {path}',
                    path: f.path,
                  })}
                />
              </HStack>
            </HStack>
          ))}
        </Stack>
      )}

      <Text variant="caption">
        {t('skills.bundle.uiHelp', {
          defaultValue:
            'Bundle files live on disk under skills/<slug>/. UI edits use atomic writes with CAS — concurrent disk edits are detected and surfaced as conflicts.',
        })}
      </Text>

      <SkillAssetEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        organizationId={organizationId}
        skillSlug={skillSlug}
        assetPath={editingPath}
      />

      <DeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('skills.asset.deleteTitle', { defaultValue: 'Delete file' })}
        description={t('skills.asset.deleteConfirmation', {
          defaultValue:
            'Permanently remove this file from the skill bundle. This cannot be undone.',
        })}
        deleteText={t('common.delete', { defaultValue: 'Delete' })}
        isDeleting={isDeleting}
        onDelete={() => void handleDelete()}
      />
    </Stack>
  );
}

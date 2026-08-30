'use client';

import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { toast } from '@/app/hooks/use-toast';
import { BackendError } from '@/app/lib/backend/backend-error';
import { useT } from '@/lib/i18n/client';

import {
  useCreateTaskLabel,
  useDeleteTaskLabel,
  useEnsureDefaultTaskLabels,
  useUpdateTaskLabel,
} from '../hooks/mutations';
import { useTaskLabels } from '../hooks/queries';
import { labelColor } from '../lib/labels';
import { TaskLabelBadge } from './task-label-badge';

const MAX_LABEL_LENGTH = 50;

/**
 * Project-scoped label catalog manager. Create, rename, and delete labels
 * here — colour is derived automatically from the name. The task picker only
 * attaches existing labels.
 *
 * Default labels (bug / feature / improvement) are seeded when the dialog
 * opens (user gesture), not on mount via an effect.
 */
export function LabelManageDialog({
  open,
  onOpenChange,
  projectId,
  canEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  canEdit: boolean;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { labels } = useTaskLabels(projectId);
  const createLabel = useCreateTaskLabel();
  const updateLabel = useUpdateTaskLabel();
  const deleteLabel = useDeleteTaskLabel();
  const ensureDefaults = useEnsureDefaultTaskLabels();

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (next && canEdit && !seeded) {
      setSeeded(true);
      void ensureDefaults.mutateAsync({ projectId }).catch(() => {
        setSeeded(false);
      });
    }
    if (!next) {
      setEditingId(null);
      setEditName('');
    }
    onOpenChange(next);
  };

  const onError = (error: unknown, fallback: string) => {
    if (error instanceof BackendError) {
      const code = error.data?.code;
      if (typeof code === 'string') {
        toast({
          title: t(`labels.errors.${code}`, { defaultValue: fallback }),
          variant: 'destructive',
        });
        return;
      }
    }
    toast({ title: fallback, variant: 'destructive' });
  };

  const onCreate = async () => {
    const name = newName.trim().toLowerCase();
    if (!name || !canEdit) return;
    setBusy(true);
    try {
      await createLabel.mutateAsync({ projectId, name });
      setNewName('');
    } catch (error) {
      onError(error, t('labels.errors.createFailed'));
    } finally {
      setBusy(false);
    }
  };

  const onSaveRename = async (labelId: string) => {
    const name = editName.trim().toLowerCase();
    if (!name || !canEdit) return;
    setBusy(true);
    try {
      await updateLabel.mutateAsync({ labelId, name });
      setEditingId(null);
      setEditName('');
    } catch (error) {
      onError(error, t('labels.errors.renameFailed'));
    } finally {
      setBusy(false);
    }
  };

  const onCancelRename = () => {
    setEditingId(null);
    setEditName('');
  };

  const onConfirmDelete = async () => {
    if (!pendingDelete || !canEdit) return;
    setBusy(true);
    try {
      await deleteLabel.mutateAsync({
        labelId: pendingDelete.id,
        detach: true,
      });
      setPendingDelete(null);
    } catch (error) {
      onError(error, t('labels.errors.deleteFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={handleOpenChange}
        title={t('labels.manageTitle')}
        description={t('labels.manageDescription')}
        size="md"
      >
        <Stack gap={4} className="pt-1">
          {labels.length === 0 ? (
            <Text as="p" variant="muted" className="text-sm">
              {t('labels.empty')}
            </Text>
          ) : (
            <ul className="border-border divide-border max-h-72 divide-y overflow-y-auto rounded-lg border">
              {labels.map((label) => {
                const isEditing = editingId === label._id;
                return (
                  <li key={label._id} className="px-2.5 py-2">
                    <Row gap={2} align="center">
                      {isEditing ? (
                        <>
                          <input
                            autoFocus
                            value={editName}
                            maxLength={MAX_LABEL_LENGTH}
                            disabled={busy}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void onSaveRename(label._id);
                              }
                              if (e.key === 'Escape') onCancelRename();
                            }}
                            className="border-border bg-background min-w-0 flex-1 rounded-md border px-2 py-1 text-sm outline-none"
                          />
                          <Button
                            type="button"
                            size="sm"
                            disabled={busy || editName.trim().length === 0}
                            onClick={() => void onSaveRename(label._id)}
                          >
                            {tCommon('actions.save')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={onCancelRename}
                          >
                            {tCommon('actions.cancel')}
                          </Button>
                        </>
                      ) : (
                        <>
                          <TaskLabelBadge
                            label={label.name}
                            color={labelColor(label.name)}
                            className="min-w-0"
                          />
                          {canEdit && (
                            <Row gap={1} className="ml-auto shrink-0">
                              <IconButton
                                icon={Pencil}
                                size="sm"
                                variant="ghost"
                                aria-label={t('labels.rename')}
                                disabled={busy}
                                onClick={() => {
                                  setEditingId(label._id);
                                  setEditName(label.name);
                                }}
                              />
                              <IconButton
                                icon={Trash2}
                                size="sm"
                                variant="ghost"
                                aria-label={tCommon('actions.delete')}
                                disabled={busy}
                                onClick={() =>
                                  setPendingDelete({
                                    id: label._id,
                                    name: label.name,
                                  })
                                }
                              />
                            </Row>
                          )}
                        </>
                      )}
                    </Row>
                  </li>
                );
              })}
            </ul>
          )}

          {canEdit && (
            <Stack gap={2}>
              <Text as="h3" variant="label">
                {t('labels.createHeading')}
              </Text>
              <Row gap={2} align="center">
                <input
                  type="text"
                  value={newName}
                  maxLength={MAX_LABEL_LENGTH}
                  disabled={busy}
                  placeholder={t('labels.namePlaceholder')}
                  aria-label={t('labels.namePlaceholder')}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void onCreate();
                    }
                  }}
                  className="border-border bg-background min-w-0 flex-1 rounded-md border px-2.5 py-1.5 text-sm outline-none"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || newName.trim().length === 0}
                  onClick={() => void onCreate()}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  {t('actions.add')}
                </Button>
              </Row>
            </Stack>
          )}
        </Stack>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title={t('labels.deleteConfirmTitle')}
        description={t('labels.deleteConfirmDescription', {
          label: pendingDelete?.name ?? '',
        })}
        confirmText={tCommon('actions.delete')}
        variant="destructive"
        isLoading={busy}
        onConfirm={() => void onConfirmDelete()}
      />
    </>
  );
}

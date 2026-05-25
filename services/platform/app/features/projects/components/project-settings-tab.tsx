'use client';

import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import { useEffect, useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  useArchiveProject,
  useDeleteProject,
  useRestoreProject,
  useUpdateProjectIdentity,
} from '../hooks/mutations';
import { useProject } from '../hooks/queries';

interface ProjectSettingsTabProps {
  organizationId: string;
  projectId: Id<'projects'>;
}

export function ProjectSettingsTab({
  organizationId,
  projectId,
}: ProjectSettingsTabProps) {
  const { t } = useT('projects');
  const navigate = useNavigate();
  const { project } = useProject(projectId);
  const { mutateAsync: updateIdentity } = useUpdateProjectIdentity();
  const { mutateAsync: archiveProject } = useArchiveProject();
  const { mutateAsync: restoreProject } = useRestoreProject();
  const { mutateAsync: deleteProject } = useDeleteProject();

  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cascade, setCascade] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setName(project?.name ?? '');
    setDescription(project?.description ?? '');
  }, [project?.name, project?.description]);

  if (!project) return null;
  const canEdit = project.canEdit;
  const canAdminister = project.canAdminister;

  const saveIdentity = async () => {
    if (!canEdit) return;
    try {
      await updateIdentity({
        projectId,
        name,
        description: description || null,
      });
      toast({ title: t('settings.saveSuccess'), variant: 'success' });
    } catch (error) {
      console.error('updateProjectIdentity failed', error);
      toast({ title: t('settings.saveError'), variant: 'destructive' });
    }
  };

  const handleArchiveToggle = async () => {
    if (!canAdminister) return;
    try {
      if (project.archivedAt) {
        await restoreProject({ projectId });
        toast({ title: t('settings.restoreSuccess'), variant: 'success' });
      } else {
        await archiveProject({ projectId });
        toast({ title: t('settings.archiveSuccess'), variant: 'success' });
      }
    } catch (error) {
      console.error('archive/restore failed', error);
      toast({
        title: project.archivedAt
          ? t('settings.restoreError')
          : t('settings.archiveError'),
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (!canAdminister) return;
    if (cascade && confirmPhrase.trim() !== project.name.trim()) {
      toast({
        title: t('errors.PROJECT_CONFIRM_PHRASE_MISMATCH'),
        variant: 'destructive',
      });
      return;
    }
    setIsDeleting(true);
    try {
      await deleteProject({
        projectId,
        mode: cascade ? 'cascade' : 'detach',
        confirmPhrase: cascade ? confirmPhrase : undefined,
      });
      toast({ title: t('settings.deleteSuccess'), variant: 'success' });
      setDeleteOpen(false);
      void navigate({
        to: '/dashboard/$id/projects',
        params: { id: organizationId },
      });
    } catch (error) {
      if (error instanceof ConvexError) {
        const code = error.data?.code;
        if (code === 'PROJECT_CONFIRM_PHRASE_MISMATCH') {
          toast({
            title: t('errors.PROJECT_CONFIRM_PHRASE_MISMATCH'),
            variant: 'destructive',
          });
          return;
        }
        if (code === 'PROJECT_LEGAL_HOLD') {
          toast({
            title: t('errors.PROJECT_LEGAL_HOLD'),
            variant: 'destructive',
          });
          return;
        }
      }
      console.error('deleteProject failed', error);
      toast({ title: t('settings.deleteError'), variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Stack gap={6} className="p-6">
      <section>
        <Heading level={2} size="base" className="mb-3">
          {t('settings.identity')}
        </Heading>
        <Stack gap={3}>
          <Input
            id="project-settings-name"
            label={t('settings.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
            maxLength={80}
          />
          <Textarea
            id="project-settings-description"
            label={t('settings.description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canEdit}
            rows={3}
            maxLength={500}
          />
          {canEdit ? (
            <div>
              <Button variant="secondary" size="sm" onClick={saveIdentity}>
                {t('settings.saveSuccess')}
              </Button>
            </div>
          ) : null}
        </Stack>
      </section>

      {canAdminister ? (
        <section className="border-destructive/30 rounded-md border p-4">
          <Heading level={2} size="base" className="text-destructive mb-3">
            {t('settings.dangerZone')}
          </Heading>
          <Stack gap={3}>
            <div className="flex items-center justify-between gap-4">
              <Text variant="muted" className="flex-1 text-sm">
                {project.archivedAt
                  ? t('settings.restoreButton')
                  : t('settings.archiveButton')}
              </Text>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleArchiveToggle}
              >
                {project.archivedAt
                  ? t('settings.restoreButton')
                  : t('settings.archiveButton')}
              </Button>
            </div>
            <div className="flex items-center justify-between gap-4">
              <Text variant="muted" className="flex-1 text-sm">
                {t('settings.deleteButton')}
              </Text>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteOpen(true)}
              >
                {t('settings.deleteButton')}
              </Button>
            </div>
          </Stack>
        </section>
      ) : null}

      <DeleteDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) {
            setCascade(false);
            setConfirmPhrase('');
          }
        }}
        title={t('settings.deleteDialogTitle')}
        description={t('settings.deleteDialogDescription')}
        deleteText={t('settings.deleteSubmit')}
        isDeleting={isDeleting}
        disableDelete={cascade && confirmPhrase.trim() !== project.name.trim()}
        onDelete={handleDelete}
      >
        <Stack gap={3}>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={cascade}
              onChange={(e) => setCascade(e.target.checked)}
              className="mt-1"
            />
            <span>{t('settings.deleteCascadeCheckbox')}</span>
          </label>
          {cascade ? (
            <Input
              id="project-delete-confirm"
              label={t('settings.deleteConfirmPhrase')}
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
              placeholder={project.name}
            />
          ) : null}
        </Stack>
      </DeleteDialog>
    </Stack>
  );
}

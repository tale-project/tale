'use client';

import { useNavigate } from '@tanstack/react-router';
import { Archive, ArchiveRestore, Copy, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { toast } from '@/app/hooks/use-toast';
import { BackendError } from '@/app/lib/backend/backend-error';
import { useT } from '@/lib/i18n/client';

import { useDuplicateProject } from '../hooks/mutations';
import { ProjectArchiveDialog } from './project-archive-dialog';
import { ProjectDeleteDialog } from './project-delete-dialog';
import { ProjectRenameDialog } from './project-rename-dialog';

interface ProjectRowActionsProps {
  organizationId: string;
  projectId: string;
  projectName: string;
  isArchived: boolean;
  canEdit: boolean;
  canAdminister: boolean;
}

export function ProjectRowActions({
  organizationId,
  projectId,
  projectName,
  isArchived,
  canEdit,
  canAdminister,
}: ProjectRowActionsProps) {
  const { t } = useT('projects');
  const navigate = useNavigate();
  const dialogs = useEntityRowDialogs(['rename', 'archive', 'delete']);
  const { mutateAsync: duplicateProject } = useDuplicateProject();
  const [isDuplicating, setIsDuplicating] = useState(false);

  const handleDuplicate = useCallback(async () => {
    if (isDuplicating) return;
    setIsDuplicating(true);
    try {
      const newProjectId = await duplicateProject({ projectId });
      toast({ title: t('rowActions.duplicateSuccess'), variant: 'success' });
      void navigate({
        to: '/dashboard/$id/projects/$projectId/tasks',
        params: {
          id: organizationId,
          projectId: newProjectId,
        },
      });
    } catch (error) {
      if (error instanceof BackendError) {
        const code = error.data?.code;
        if (code === 'RATE_LIMITED') {
          toast({ title: t('errors.RATE_LIMITED'), variant: 'destructive' });
          return;
        }
        if (code === 'RBAC_FORBIDDEN' || code === 'PROJECT_FORBIDDEN') {
          toast({
            title: t('errors.' + code, {
              defaultValue: t('rowActions.duplicateError'),
            }),
            variant: 'destructive',
          });
          return;
        }
      }
      console.error('duplicateProject failed', error);
      toast({ title: t('rowActions.duplicateError'), variant: 'destructive' });
    } finally {
      setIsDuplicating(false);
    }
  }, [isDuplicating, duplicateProject, projectId, t, navigate, organizationId]);

  const actions = useMemo(
    () => [
      {
        key: 'duplicate',
        label: t('rowActions.duplicate'),
        icon: Copy,
        onClick: () => void handleDuplicate(),
        visible: canEdit,
      },
      {
        key: 'rename',
        label: t('rowActions.rename'),
        icon: Pencil,
        onClick: () => dialogs.open.rename(),
        visible: canEdit,
      },
      {
        key: 'archive',
        label: isArchived ? t('rowActions.restore') : t('rowActions.archive'),
        icon: isArchived ? ArchiveRestore : Archive,
        onClick: () => dialogs.open.archive(),
        separator: true,
        visible: canAdminister,
      },
      {
        key: 'delete',
        label: t('rowActions.delete'),
        icon: Trash2,
        destructive: true,
        onClick: () => dialogs.open.delete(),
        visible: canAdminister,
      },
    ],
    [t, dialogs.open, canEdit, canAdminister, isArchived, handleDuplicate],
  );

  if (!canEdit && !canAdminister) return null;

  return (
    <>
      <EntityRowActions actions={actions} />

      <ProjectRenameDialog
        open={dialogs.isOpen.rename}
        onOpenChange={dialogs.setOpen.rename}
        projectId={projectId}
        currentName={projectName}
      />

      <ProjectArchiveDialog
        open={dialogs.isOpen.archive}
        onOpenChange={dialogs.setOpen.archive}
        projectId={projectId}
        isArchived={isArchived}
        projectName={projectName}
      />

      <ProjectDeleteDialog
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        organizationId={organizationId}
        projectId={projectId}
        projectName={projectName}
      />
    </>
  );
}

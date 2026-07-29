'use client';

import { Stack } from '@tale/ui/layout';
import { useNavigate } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import { useEffect, useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Input } from '@/app/components/ui/forms/input';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useDeleteProject } from '../hooks/mutations';

interface ProjectDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  projectId: Id<'projects'>;
  projectName: string;
  /**
   * Navigate to the projects list after a successful delete. Set to false
   * when the dialog is launched from the table row (caller is already on
   * the list page).
   */
  navigateOnSuccess?: boolean;
}

export function ProjectDeleteDialog({
  open,
  onOpenChange,
  organizationId,
  projectId,
  projectName,
  navigateOnSuccess = false,
}: ProjectDeleteDialogProps) {
  const { t } = useT('projects');
  const navigate = useNavigate();
  const { mutateAsync: deleteProject } = useDeleteProject();
  const [cascade, setCascade] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!open) {
      setCascade(false);
      setConfirmPhrase('');
    }
  }, [open]);

  // H1: server uses case-insensitive compare; UI does the same to avoid a
  // confusing "Type the project name" reject when the user trimmed only.
  const phraseSatisfied =
    !cascade ||
    projectName.trim().localeCompare(confirmPhrase.trim(), undefined, {
      sensitivity: 'base',
    }) === 0;

  const handleDelete = async () => {
    if (!phraseSatisfied) {
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
      onOpenChange(false);
      if (navigateOnSuccess) {
        void navigate({
          to: '/dashboard/$id/projects',
          params: { id: organizationId },
        });
      }
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
        if (code === 'PROJECT_HAS_BOUND_AUTOMATIONS') {
          // The backend names the bound automation(s) in error.data.automations
          // so the operator knows exactly what to uninstall first; surface
          // them when present, otherwise fall back to the generic actionable
          // message.
          const rawAutomations: unknown = error.data?.automations;
          const automations = Array.isArray(rawAutomations)
            ? rawAutomations.filter(
                (automation): automation is string =>
                  typeof automation === 'string',
              )
            : [];
          toast({
            title:
              automations.length > 0
                ? t('errors.PROJECT_HAS_BOUND_AUTOMATIONS_NAMED', {
                    automations: automations.join(', '),
                  })
                : t('errors.PROJECT_HAS_BOUND_AUTOMATIONS'),
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
        if (code === 'RATE_LIMITED') {
          toast({ title: t('errors.RATE_LIMITED'), variant: 'destructive' });
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
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('settings.deleteDialogTitle')}
      description={t('settings.deleteDialogDescription')}
      deleteText={t('settings.deleteSubmit')}
      isDeleting={isDeleting}
      disableDelete={!phraseSatisfied}
      onDelete={handleDelete}
    >
      <Stack gap={3}>
        <Checkbox
          label={t('settings.deleteCascadeCheckbox')}
          checked={cascade}
          onCheckedChange={(v) => setCascade(Boolean(v))}
        />
        {cascade ? (
          <Input
            id="project-delete-confirm"
            label={t('settings.deleteConfirmPhrase')}
            value={confirmPhrase}
            onChange={(e) => setConfirmPhrase(e.target.value)}
            placeholder={projectName}
          />
        ) : null}
      </Stack>
    </DeleteDialog>
  );
}

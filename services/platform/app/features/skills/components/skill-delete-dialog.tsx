'use client';

import { useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useDeleteSkill } from '../hooks/mutations';

function extractCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object' || !('data' in err)) return undefined;
  const data = (err as { data?: unknown }).data;
  if (!isRecord(data)) return undefined;
  return typeof data.code === 'string' ? data.code : undefined;
}

interface SkillDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillSlug: string;
  organizationId: string;
  /**
   * SHA-256 of SKILL.md at the moment the caller loaded the skill. Sent
   * to the backend as `expectedHash` so a concurrent edit between view
   * and confirm surfaces as CONFLICT instead of silently nuking a
   * different version of the skill than the user thinks they're seeing.
   */
  expectedHash?: string;
  onDeleted?: () => void;
}

export function SkillDeleteDialog({
  open,
  onOpenChange,
  skillSlug,
  organizationId,
  expectedHash,
  onDeleted,
}: SkillDeleteDialogProps) {
  const { t } = useT('settings');
  const { mutateAsync: deleteSkill } = useDeleteSkill();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteSkill({
        organizationId,
        slug: skillSlug,
        ...(expectedHash !== undefined && { expectedHash }),
      });
      toast({
        title: t('skills.skillDeleted', { defaultValue: 'Skill deleted' }),
      });
      onOpenChange(false);
      onDeleted?.();
    } catch (error) {
      console.error(error);
      // Surface the backend's CAS-conflict signal distinctly so the user
      // knows to reload, rather than seeing a generic "delete failed"
      // and hammering the button (which would never succeed).
      toast({
        title:
          extractCode(error) === 'CONFLICT'
            ? t('skills.skillDeleteConflict', {
                defaultValue:
                  'Skill changed since you opened this dialog. Reload and retry.',
              })
            : t('skills.skillDeleteFailed', {
                defaultValue: 'Failed to delete skill',
              }),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('skills.deleteSkill', { defaultValue: 'Delete skill' })}
      description={t('skills.deleteConfirmation', {
        defaultValue:
          'This removes the skill bundle from disk. The skill will no longer be available to any agent in this organization.',
      })}
      preview={{ primary: skillSlug }}
      deleteText={t('skills.deleteSkill', { defaultValue: 'Delete skill' })}
      isDeleting={isDeleting}
      onDelete={handleConfirm}
    />
  );
}

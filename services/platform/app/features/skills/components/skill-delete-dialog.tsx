'use client';

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useDeleteSkill } from '../hooks/mutations';
import { useFindAgentsBindingSkill } from '../hooks/queries';

interface SkillDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillSlug: string;
  organizationId: string;
  onDeleted?: () => void;
}

export function SkillDeleteDialog({
  open,
  onOpenChange,
  skillSlug,
  organizationId,
  onDeleted,
}: SkillDeleteDialogProps) {
  const { t } = useT('settings');
  const { mutateAsync: deleteSkill } = useDeleteSkill();
  const { data: relatedAgents } = useFindAgentsBindingSkill(
    organizationId,
    skillSlug,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteSkill({ organizationId, slug: skillSlug });
      toast({
        title: t('skills.skillDeleted', { defaultValue: 'Skill deleted' }),
      });
      onOpenChange(false);
      onDeleted?.();
    } catch (error) {
      console.error(error);
      toast({
        title: t('skills.skillDeleteFailed', {
          defaultValue: 'Failed to delete skill',
        }),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const hasRelated = Array.isArray(relatedAgents) && relatedAgents.length > 0;

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('skills.deleteSkill', { defaultValue: 'Delete skill' })}
      description={t('skills.deleteConfirmation', {
        defaultValue:
          'This removes the skill bundle from disk. Agents bound to it will keep the binding entry and log a runtime warning until you re-edit them.',
      })}
      deleteText={t('skills.deleteSkill', { defaultValue: 'Delete skill' })}
      isDeleting={isDeleting}
      onDelete={handleConfirm}
    >
      {hasRelated ? (
        <Stack gap={2} className="mt-2">
          <Text variant="label">
            {t('skills.relatedAgentsHeader', {
              defaultValue: 'Bound by these agents',
              count: relatedAgents.length,
            })}
          </Text>
          <ul className="ml-4 list-disc">
            {relatedAgents.map((a) => (
              <li key={a.agentName}>
                <Text as="span" variant="body">
                  {a.displayName ?? a.agentName}
                </Text>
                {a.displayName ? (
                  <Text as="span" variant="muted" className="ml-2">
                    ({a.agentName})
                  </Text>
                ) : null}
              </li>
            ))}
          </ul>
        </Stack>
      ) : null}
    </DeleteDialog>
  );
}

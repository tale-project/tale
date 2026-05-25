'use client';

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-guards';

import { useDeleteSkill } from '../hooks/mutations';
import { useFindAgentsBindingSkill } from '../hooks/queries';

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
  const { data: relatedAgents } = useFindAgentsBindingSkill(
    organizationId,
    skillSlug,
    // Only fire the (heavy) readdir+parse-every-agent scan when the
    // dialog actually opens. Without this, the table mounts one dialog
    // per row so the query fires 50× on initial page load.
    { enabled: open },
  );
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

  const isResolvingRelated = open && relatedAgents === undefined;
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
      preview={{ primary: skillSlug }}
      warning={
        hasRelated
          ? t('skills.deleteWarningBindings', {
              defaultValue:
                '{count} agent(s) bind this skill and will log runtime warnings until re-edited.',
              count: relatedAgents.length,
            })
          : undefined
      }
      deleteText={t('skills.deleteSkill', { defaultValue: 'Delete skill' })}
      isDeleting={isDeleting}
      disableDelete={isResolvingRelated}
      onDelete={handleConfirm}
    >
      {isResolvingRelated ? (
        <Text variant="muted" className="mt-2 text-xs">
          {t('skills.deleteResolvingBindings', {
            defaultValue: 'Checking which agents bind this skill…',
          })}
        </Text>
      ) : hasRelated ? (
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

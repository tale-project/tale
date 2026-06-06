'use client';

import { Copy, RotateCw, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useDuplicateSkill } from '../hooks/mutations';
import { SkillDeleteDialog } from './skill-delete-dialog';
import { SkillUploadDialog } from './skill-upload/skill-upload-dialog';

interface SkillRowActionsProps {
  skillSlug: string;
  organizationId: string;
  /**
   * SHA-256 of SKILL.md observed when the list was loaded. Forwarded to
   * the delete action so the backend can refuse if the skill has been
   * edited between page load and the user's confirmation click.
   */
  expectedHash?: string;
  onDeleted?: () => void;
  /** Called with the new slug after a duplicate so the list can react. */
  onDuplicated?: (newSlug: string) => void;
}

export function SkillRowActions({
  skillSlug,
  organizationId,
  expectedHash,
  onDeleted,
  onDuplicated,
}: SkillRowActionsProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const dialogs = useEntityRowDialogs(['delete']);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const { mutateAsync: duplicateSkill } = useDuplicateSkill();
  const [isDuplicating, setIsDuplicating] = useState(false);

  const handleDuplicate = useCallback(async () => {
    if (isDuplicating) return;
    setIsDuplicating(true);
    try {
      const { newSlug } = await duplicateSkill({
        organizationId,
        slug: skillSlug,
      });
      toast({
        title: t('skills.skillDuplicated', {
          defaultValue: 'Skill duplicated as {slug}',
          slug: newSlug,
        }),
        variant: 'success',
      });
      onDuplicated?.(newSlug);
    } catch (error) {
      console.error(error);
      toast({
        title: t('skills.skillDuplicateFailed', {
          defaultValue: 'Failed to duplicate skill',
        }),
        variant: 'destructive',
      });
    } finally {
      setIsDuplicating(false);
    }
  }, [
    isDuplicating,
    duplicateSkill,
    organizationId,
    skillSlug,
    t,
    onDuplicated,
  ]);

  const actions = [
    {
      key: 'replace',
      label: t('skills.actions.replaceBundle', {
        defaultValue: 'Replace bundle',
      }),
      icon: RotateCw,
      onClick: () => setReplaceOpen(true),
    },
    {
      key: 'duplicate',
      label: t('skills.actions.duplicate', { defaultValue: 'Duplicate' }),
      icon: Copy,
      disabled: isDuplicating,
      onClick: () => void handleDuplicate(),
    },
    {
      key: 'delete',
      label: tCommon('actions.delete'),
      icon: Trash2,
      destructive: true,
      onClick: () => dialogs.open.delete(),
    },
  ];

  return (
    <>
      <EntityRowActions actions={actions} />
      <SkillDeleteDialog
        skillSlug={skillSlug}
        organizationId={organizationId}
        expectedHash={expectedHash}
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        onDeleted={onDeleted}
      />
      <SkillUploadDialog
        open={replaceOpen}
        onOpenChange={setReplaceOpen}
        organizationId={organizationId}
        onUploaded={(newSlug) => {
          setReplaceOpen(false);
          onDuplicated?.(newSlug);
        }}
      />
    </>
  );
}

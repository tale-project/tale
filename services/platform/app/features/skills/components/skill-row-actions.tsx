'use client';

import { Trash2 } from 'lucide-react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { useT } from '@/lib/i18n/client';

import { SkillDeleteDialog } from './skill-delete-dialog';

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
}

export function SkillRowActions({
  skillSlug,
  organizationId,
  expectedHash,
  onDeleted,
}: SkillRowActionsProps) {
  const { t: tCommon } = useT('common');
  const dialogs = useEntityRowDialogs(['delete']);

  const actions = [
    {
      key: 'delete',
      label: tCommon('delete'),
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
    </>
  );
}

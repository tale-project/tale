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
  onDeleted?: () => void;
}

export function SkillRowActions({
  skillSlug,
  organizationId,
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
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        onDeleted={onDeleted}
      />
    </>
  );
}

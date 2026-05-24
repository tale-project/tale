'use client';

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  DataTableActionMenu,
  type DataTableActionMenuItem,
} from '@/app/components/ui/data-table/data-table-action-menu';
import { useT } from '@/lib/i18n/client';

import { CreateSkillDialog } from './skill-create-dialog';

interface SkillsActionMenuProps {
  organizationId: string;
}

export function SkillsActionMenu({ organizationId }: SkillsActionMenuProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const { t } = useT('settings');

  const menuItems = useMemo<DataTableActionMenuItem[]>(
    () => [
      {
        label: t('skills.createSkill', { defaultValue: 'Create skill' }),
        icon: Plus,
        onClick: () => setCreateOpen(true),
      },
    ],
    [t],
  );

  return (
    <>
      <DataTableActionMenu
        label={t('skills.createSkill', { defaultValue: 'Create skill' })}
        icon={Plus}
        menuItems={menuItems}
      />
      <CreateSkillDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
      />
    </>
  );
}

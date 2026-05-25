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
  /** Called with the new slug after the create-skill mutation succeeds. */
  onCreated?: (slug: string) => void;
}

export function SkillsActionMenu({
  organizationId,
  onCreated,
}: SkillsActionMenuProps) {
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
        onCreated={onCreated}
      />
    </>
  );
}

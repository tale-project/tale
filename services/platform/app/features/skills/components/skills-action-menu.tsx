'use client';

import { Upload } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  DataTableActionMenu,
  type DataTableActionMenuItem,
} from '@/app/components/ui/data-table/data-table-action-menu';
import { useT } from '@/lib/i18n/client';

import { SkillUploadDialog } from './skill-upload/skill-upload-dialog';

interface SkillsActionMenuProps {
  organizationId: string;
  /** Called with the slug once a successful upload lands on disk. */
  onUploaded?: (slug: string) => void;
}

export function SkillsActionMenu({
  organizationId,
  onUploaded,
}: SkillsActionMenuProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const { t } = useT('settings');

  const label = t('skills.uploadSkill', { defaultValue: 'Upload skill' });
  const menuItems = useMemo<DataTableActionMenuItem[]>(
    () => [
      {
        label,
        icon: Upload,
        onClick: () => setUploadOpen(true),
      },
    ],
    [label],
  );

  return (
    <>
      <DataTableActionMenu label={label} icon={Upload} menuItems={menuItems} />
      <SkillUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        organizationId={organizationId}
        onUploaded={onUploaded}
      />
    </>
  );
}

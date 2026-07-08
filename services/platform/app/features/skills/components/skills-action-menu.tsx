'use client';

import { LayoutTemplate, Plus, Upload } from 'lucide-react';
import { useState } from 'react';

import {
  DataTableActionMenu,
  type DataTableActionMenuItem,
} from '@/app/components/ui/data-table/data-table-action-menu';
import { useT } from '@/lib/i18n/client';

import { SkillCreateDialog } from './skill-create-dialog';
import { SkillTemplateDialog } from './skill-template-dialog';
import { SkillUploadDialog } from './skill-upload/skill-upload-dialog';

interface SkillsActionMenuProps {
  organizationId: string;
  /** Called with the slug once a created/uploaded bundle lands on disk. */
  onUploaded?: (slug: string) => void;
  /** Page-specific items appended after the create items (e.g. catalog sync). */
  extraMenuItems?: DataTableActionMenuItem[];
}

/**
 * The Skills settings page's Add dropdown — the agents-menu pattern:
 * Blank (a minimal SKILL.md bundle from a name), From template (copy a
 * built-in catalog skill), Upload (a .zip bundle), plus any page-appended
 * items (the builtin-sync action).
 */
export function SkillsActionMenu({
  organizationId,
  onUploaded,
  extraMenuItems,
}: SkillsActionMenuProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const { t } = useT('settings');

  return (
    <>
      <DataTableActionMenu
        label={t('skills.addMenu.label', { defaultValue: 'Add skill' })}
        icon={Plus}
        menuItems={[
          {
            label: t('skills.createMenu.blank'),
            icon: Plus,
            onClick: () => setCreateOpen(true),
          },
          {
            label: t('skills.createMenu.fromTemplate'),
            icon: LayoutTemplate,
            onClick: () => setTemplateOpen(true),
          },
          {
            label: t('skills.uploadSkill', { defaultValue: 'Upload skill' }),
            icon: Upload,
            onClick: () => setUploadOpen(true),
          },
          ...(extraMenuItems ?? []),
        ]}
      />
      <SkillCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
        onCreated={onUploaded}
      />
      <SkillTemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        organizationId={organizationId}
        onCreated={onUploaded}
      />
      <SkillUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        organizationId={organizationId}
        onUploaded={onUploaded}
      />
    </>
  );
}

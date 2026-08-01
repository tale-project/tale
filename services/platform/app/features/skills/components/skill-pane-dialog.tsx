'use client';

import { useCallback } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { useT } from '@/lib/i18n/client';

import { useSkills } from '../hooks/queries';
import { SkillCreatePane } from './skill-create-pane';
import { SkillDetailPane } from './skill-detail-pane';
import { SkillUploadPane } from './skill-upload/skill-upload-pane';

/** Which pane the dialog is showing. */
export type SkillPane =
  | { view: 'create' }
  | { view: 'upload'; mode: 'zip' | 'folder' }
  | { view: 'detail'; slug: string };

/**
 * One skill, at whatever stage: authoring a new text skill, uploading a bundle,
 * or inspecting and editing an existing one. Only confirm dialogs stack on top.
 *
 * There is no browse pane. The skills TABLE is the browse surface, and a dialog
 * that also listed skills meant two places to look for the same thing — so the
 * table's row click and its Add menu each open this dialog directly at the pane
 * they mean, and creating or uploading lands on the new skill's detail pane.
 */
export function SkillPaneDialog({
  organizationId,
  pane,
  onPaneChange,
  onClose,
}: {
  organizationId: string;
  pane: SkillPane;
  onPaneChange: (next: SkillPane) => void;
  onClose: () => void;
}) {
  const { t } = useT('skills');
  const skillsQuery = useSkills(organizationId);
  const existingSlugs = (skillsQuery.data?.skills ?? []).map(
    (skill: { slug: string }) => skill.slug,
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );

  const title =
    pane.view === 'create'
      ? t('createDialog.title')
      : pane.view === 'upload'
        ? t('upload.dialogTitle')
        : pane.slug;

  return (
    <Dialog
      open
      onOpenChange={handleOpenChange}
      title={title}
      // The settings measure, not `wide`: a skill's file tree and its editor sit
      // side by side, and at 1100px the pair floated in space.
      size="3xl"
      // Fixed height, same as the expanded notifications panel: every pane fills
      // the same frame instead of the dialog resizing around whichever content
      // happens to be shortest.
      className="md:h-[85dvh] md:max-h-[85dvh]"
    >
      <div className="flex h-full min-h-0 flex-col">
        {pane.view === 'create' && (
          <SkillCreatePane
            organizationId={organizationId}
            existingSlugs={existingSlugs}
            onCreated={(slug) => onPaneChange({ view: 'detail', slug })}
            onCancel={onClose}
          />
        )}
        {pane.view === 'upload' && (
          <SkillUploadPane
            organizationId={organizationId}
            mode={pane.mode}
            onUploaded={(slug) => onPaneChange({ view: 'detail', slug })}
            onCancel={onClose}
          />
        )}
        {pane.view === 'detail' && (
          <SkillDetailPane
            organizationId={organizationId}
            slug={pane.slug}
            onDeleted={onClose}
            onClose={onClose}
          />
        )}
      </div>
    </Dialog>
  );
}

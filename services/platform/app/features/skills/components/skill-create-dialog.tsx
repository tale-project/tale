'use client';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { useT } from '@/lib/i18n/client';

import { useSkills } from '../hooks/queries';
import { SkillCreatePane } from './skill-create-pane';

export function SkillCreateDialog({
  organizationId,
  open,
  onCreated,
  onClose,
}: {
  organizationId: string;
  open: boolean;
  onCreated: (slug: string) => void;
  onClose: () => void;
}) {
  const { t } = useT('skills');
  const skillsQuery = useSkills(organizationId);
  const existingSlugs = (skillsQuery.data?.skills ?? []).map(
    (skill: { slug: string }) => skill.slug,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('createDialog.title')}
      size="md"
    >
      <SkillCreatePane
        organizationId={organizationId}
        existingSlugs={existingSlugs}
        onCreated={onCreated}
        onCancel={onClose}
      />
    </Dialog>
  );
}

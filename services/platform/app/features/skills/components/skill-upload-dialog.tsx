'use client';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { useT } from '@/lib/i18n/client';

import { SkillUploadPane } from './skill-upload/skill-upload-pane';

export function SkillUploadDialog({
  organizationId,
  mode,
  open,
  onUploaded,
  onClose,
}: {
  organizationId: string;
  mode: 'zip' | 'folder';
  open: boolean;
  onUploaded: (slug: string) => void;
  onClose: () => void;
}) {
  const { t } = useT('skills');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('upload.dialogTitle')}
      size="lg"
    >
      <SkillUploadPane
        organizationId={organizationId}
        mode={mode}
        onUploaded={onUploaded}
        onCancel={onClose}
      />
    </Dialog>
  );
}

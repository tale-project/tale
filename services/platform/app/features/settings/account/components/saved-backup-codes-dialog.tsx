'use client';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

function downloadBackupCodes(codes: string[]) {
  const content = codes.join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tale-backup-codes.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface SavedBackupCodesDialogProps {
  backupCodes: string[];
  onClose: () => void;
}

export function SavedBackupCodesDialog({
  backupCodes,
  onClose,
}: SavedBackupCodesDialogProps) {
  const { t } = useT('twoFactor');
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('backupCodes.title')}
      description={t('backupCodes.warningOnce')}
      confirmText={t('backupCodes.downloadButton')}
      cancelText={t('backupCodes.doneButton')}
      onConfirm={() => downloadBackupCodes(backupCodes)}
    >
      <Stack gap={2} className="pt-2">
        <Text variant="muted" className="text-sm">
          {t('backupCodes.description')}
        </Text>
        <ul className="bg-muted grid grid-cols-2 gap-2 rounded-md border p-3 font-mono text-sm">
          {backupCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </Stack>
    </ConfirmDialog>
  );
}

'use client';

import { Card } from '@tale/ui/card';
import { Grid, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
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
        <Card padding="sm" className="bg-muted font-mono text-sm">
          <Grid as="ul" cols={2} gap={2}>
            {backupCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </Grid>
        </Card>
      </Stack>
    </ConfirmDialog>
  );
}

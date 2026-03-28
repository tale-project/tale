'use client';

import { diff } from 'jsondiffpatch';
import { format } from 'jsondiffpatch/formatters/html';
import 'jsondiffpatch/formatters/styles/html.css';
import { useMemo } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Button } from '@/app/components/ui/primitives/button';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';

interface HistoryDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentConfig: Record<string, unknown>;
  snapshotConfig: Record<string, unknown>;
  snapshotDate: string;
  isRestoring: boolean;
  onRestore: () => void;
}

export function HistoryDiffDialog({
  open,
  onOpenChange,
  currentConfig,
  snapshotConfig,
  snapshotDate,
  isRestoring,
  onRestore,
}: HistoryDiffDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { formatDate } = useFormatDate();

  const diffHtml = useMemo(() => {
    const delta = diff(currentConfig, snapshotConfig);
    if (!delta) return null;
    return format(delta, currentConfig);
  }, [currentConfig, snapshotConfig]);

  const formattedDate = useMemo(
    () => formatDate(new Date(snapshotDate), 'long'),
    [snapshotDate, formatDate],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('customAgents.history.diffTitle')}
      description={t('customAgents.history.diffDescription', {
        date: formattedDate,
      })}
    >
      <div className="max-h-[60vh] overflow-auto rounded border p-4">
        {diffHtml ? (
          <div
            className="jsondiffpatch-delta"
            dangerouslySetInnerHTML={{ __html: diffHtml }}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            {t('customAgents.history.noDifferences')}
          </p>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => onOpenChange(false)}
          disabled={isRestoring}
        >
          {tCommon('actions.cancel')}
        </Button>
        <Button
          variant="destructive"
          onClick={onRestore}
          disabled={isRestoring || !diffHtml}
        >
          {isRestoring
            ? tCommon('actions.loading')
            : t('customAgents.history.restore')}
        </Button>
      </div>
    </Dialog>
  );
}

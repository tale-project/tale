'use client';

import 'json-diff-kit/viewer.css';
import { Differ, Viewer } from 'json-diff-kit';
import { useMemo } from 'react';

import type { WorkflowJsonConfig } from '@/lib/shared/schemas/workflows';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Button } from '@/app/components/ui/primitives/button';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';

interface AutomationHistoryDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentConfig: WorkflowJsonConfig;
  snapshotConfig: WorkflowJsonConfig;
  snapshotDate: string;
  isRestoring: boolean;
  onRestore: () => void;
}

const differ = new Differ({
  detectCircular: false,
  showModifications: true,
  arrayDiffMethod: 'lcs',
});

export function AutomationHistoryDiffDialog({
  open,
  onOpenChange,
  currentConfig,
  snapshotConfig,
  snapshotDate,
  isRestoring,
  onRestore,
}: AutomationHistoryDiffDialogProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { formatDate } = useFormatDate();

  const formattedDate = useMemo(
    () => formatDate(new Date(snapshotDate), 'long'),
    [snapshotDate, formatDate],
  );

  const diff = useMemo(
    () => differ.diff(currentConfig, snapshotConfig),
    [currentConfig, snapshotConfig],
  );

  const hasChanges = useMemo(
    () =>
      diff[0].some((segment) => segment.type !== 'equal') ||
      diff[1].some((segment) => segment.type !== 'equal'),
    [diff],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('history.diffTitle')}
      description={t('history.diffDescription', {
        date: formattedDate,
      })}
      size="wide"
      footer={
        <div className="flex justify-end gap-2">
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
            disabled={isRestoring || !hasChanges}
          >
            {isRestoring ? tCommon('actions.loading') : t('history.restore')}
          </Button>
        </div>
      }
    >
      {!hasChanges ? (
        <p className="text-muted-foreground py-4 text-center text-sm">
          {t('history.noDifferences')}
        </p>
      ) : (
        <div className="json-diff-wrapper max-h-[50vh] overflow-auto rounded-md border">
          <Viewer
            diff={diff}
            indent={2}
            highlightInlineDiff
            inlineDiffOptions={{ mode: 'word', wordSeparator: ' ' }}
            hideUnchangedLines={{ threshold: 4, margin: 2 }}
          />
        </div>
      )}
    </Dialog>
  );
}

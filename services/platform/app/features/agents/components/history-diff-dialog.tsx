'use client';

import 'json-diff-kit/viewer.css';
import { Button } from '@tale/ui/button';
import { Grid, Row } from '@tale/ui/layout';
import { Differ, Viewer } from 'json-diff-kit';
import { useMemo } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { useFormatDate } from '@/app/hooks/use-format-date';
import type { AgentJsonConfig } from '@/convex/agents/file_utils';
import { useT } from '@/lib/i18n/client';

interface HistoryDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentConfig: AgentJsonConfig;
  snapshotConfig: AgentJsonConfig;
  snapshotDate: string;
  isRestoring: boolean;
  onRestore: () => void;
}

const differ = new Differ({
  detectCircular: false,
  showModifications: true,
  arrayDiffMethod: 'lcs',
});

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
      title={t('agents.history.diffTitle')}
      description={t('agents.history.diffDescription', {
        date: formattedDate,
      })}
      size="wide"
      footer={
        <Row gap={2} align="stretch" justify="end">
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
            {isRestoring
              ? tCommon('actions.loading')
              : t('agents.history.restore')}
          </Button>
        </Row>
      }
    >
      {!hasChanges ? (
        <p className="text-muted-foreground py-4 text-center text-sm">
          {t('agents.history.noDifferences')}
        </p>
      ) : (
        <div className="json-diff-wrapper max-h-[50vh] overflow-auto rounded-md border">
          <Grid
            cols={2}
            gap={0}
            className="bg-muted sticky top-0 z-20 border-b"
          >
            <div className="text-muted-foreground px-3 py-1.5 text-xs font-medium">
              {t('agents.history.currentVersion')}
            </div>
            <div className="text-muted-foreground border-l px-3 py-1.5 text-xs font-medium">
              {t('agents.history.snapshotVersion')}
            </div>
          </Grid>
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

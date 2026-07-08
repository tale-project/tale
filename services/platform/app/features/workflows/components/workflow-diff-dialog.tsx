'use client';

import 'json-diff-kit/viewer.css';
import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Differ, Viewer } from 'json-diff-kit';
import { useMemo } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { useT } from '@/lib/i18n/client';
import type { WorkflowJsonConfig } from '@/lib/shared/schemas/workflows';

interface WorkflowDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentConfig: WorkflowJsonConfig;
  /** The proposed replacement config, compared against `currentConfig`. */
  candidateConfig: WorkflowJsonConfig;
  title: string;
  description: string;
  confirmLabel: string;
  /** Visual weight of the confirm action — `destructive` (default, matches
   * the history-restore look) or `primary` for a less alarming "apply". */
  confirmVariant?: 'destructive' | 'primary';
  isConfirming: boolean;
  onConfirm: () => void;
}

const differ = new Differ({
  detectCircular: false,
  showModifications: true,
  arrayDiffMethod: 'lcs',
});

/**
 * Side-by-side JSON diff dialog for reviewing a proposed workflow config
 * before committing it — shared by the history "restore a snapshot" flow
 * (`workflow-navigation.tsx`) and the specification editor's "regenerate
 * graph from spec" flow (`workflow-specification.tsx`). Callers own all
 * copy (title/description/confirmLabel) so nothing history-specific leaks
 * into a non-history caller.
 */
export function WorkflowDiffDialog({
  open,
  onOpenChange,
  currentConfig,
  candidateConfig,
  title,
  description,
  confirmLabel,
  confirmVariant = 'destructive',
  isConfirming,
  onConfirm,
}: WorkflowDiffDialogProps) {
  const { t } = useT('workflows');
  const { t: tCommon } = useT('common');

  const diff = useMemo(
    () => differ.diff(currentConfig, candidateConfig),
    [currentConfig, candidateConfig],
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
      title={title}
      description={description}
      size="wide"
      footer={
        <Row gap={2} align="stretch" justify="end">
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={isConfirming}
          >
            {tCommon('actions.cancel')}
          </Button>
          <Button
            variant={confirmVariant}
            onClick={onConfirm}
            disabled={isConfirming || !hasChanges}
          >
            {isConfirming ? tCommon('actions.loading') : confirmLabel}
          </Button>
        </Row>
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

'use client';

import 'json-diff-kit/viewer.css';
import { Button } from '@tale/ui/button';
import { Differ, Viewer } from 'json-diff-kit';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useMemo } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { HStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';

import type { PromptVersionEntry } from '../hooks/queries';

interface PromptCompareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: PromptVersionEntry;
  snapshot: PromptVersionEntry;
  onRestore: () => void;
  isRestoring: boolean;
  onBack: () => void;
}

const differ = new Differ({
  detectCircular: false,
  showModifications: true,
  arrayDiffMethod: 'lcs',
});

export function PromptCompareDialog({
  open,
  onOpenChange,
  current,
  snapshot,
  onRestore,
  isRestoring,
  onBack,
}: PromptCompareDialogProps) {
  const { t } = useT('prompts');
  const { formatDate } = useFormatDate();

  // Diff prose as a line array (not a JSON object) so json-diff-kit produces
  // a proper line-level diff with word-level inline highlights, instead of
  // rendering `"content": "..."` as a JSON key.
  const diff = useMemo(
    () =>
      differ.diff(current.content.split('\n'), snapshot.content.split('\n')),
    [current.content, snapshot.content],
  );

  const hasChanges =
    diff[0].some((segment) => segment.type !== 'equal') ||
    diff[1].some((segment) => segment.type !== 'equal');

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('history.compareTitle', { version: String(snapshot.version) })}
      description={t('history.compareDescription', {
        date: formatDate(new Date(snapshot.publishedAt), 'long'),
      })}
      className="w-[95vw] max-w-[960px]"
      footer={
        <HStack gap={2} justify="between" className="w-full">
          <Button type="button" variant="ghost" onClick={onBack}>
            <ArrowLeft className="mr-1 size-4" />
            {t('history.backToList')}
          </Button>
          <Button
            type="button"
            onClick={onRestore}
            disabled={isRestoring || !hasChanges}
          >
            <RotateCcw className="mr-1 size-3" />
            {t('history.restore')}
          </Button>
        </HStack>
      }
    >
      {!hasChanges ? (
        <Text variant="muted" className="py-4 text-center text-sm">
          {t('history.noDifferences')}
        </Text>
      ) : (
        <div className="json-diff-wrapper max-h-[60vh] overflow-auto rounded-md border">
          <div className="bg-muted sticky top-0 z-20 grid grid-cols-2 border-b">
            <div className="text-muted-foreground px-3 py-1.5 text-xs font-medium">
              {t('history.currentVersion', {
                version: String(current.version),
              })}
            </div>
            <div className="text-muted-foreground border-l px-3 py-1.5 text-xs font-medium">
              {t('history.snapshotVersion', {
                version: String(snapshot.version),
              })}
            </div>
          </div>
          <Viewer
            diff={diff}
            indent={2}
            highlightInlineDiff
            inlineDiffOptions={{ mode: 'word', wordSeparator: ' ' }}
          />
        </div>
      )}
    </Dialog>
  );
}

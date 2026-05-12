'use client';

import 'json-diff-kit/viewer.css';
import { Button } from '@tale/ui/button';
import { Differ, Viewer } from 'json-diff-kit';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { HStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useRestorePromptFromVersion } from '../hooks/mutations';
import type { PromptTemplate, PromptVersionEntry } from '../hooks/queries';
import { usePromptHistory } from '../hooks/queries';

interface PromptHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: PromptTemplate;
}

const differ = new Differ({
  detectCircular: false,
  showModifications: true,
  arrayDiffMethod: 'lcs',
});

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function PromptHistoryDialog({
  open,
  onOpenChange,
  prompt,
}: PromptHistoryDialogProps) {
  const { t } = useT('prompts');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const restore = useRestorePromptFromVersion();
  const historyQuery = usePromptHistory(open ? prompt._id : undefined);
  const history = historyQuery.data;

  const [comparingVersion, setComparingVersion] =
    useState<PromptVersionEntry | null>(null);
  const [restoring, setRestoring] = useState<PromptVersionEntry | null>(null);

  const handleRestoreConfirm = useCallback(async () => {
    if (!restoring) return;
    try {
      await restore.mutateAsync({
        promptId: prompt._id,
        targetVersion: restoring.version,
      });
      toast({
        title: t('toast.restored', { version: String(restoring.version) }),
        variant: 'success',
      });
      setRestoring(null);
      setComparingVersion(null);
    } catch (err) {
      console.error('[prompt-history] restore failed', err);
      toast({
        title: t('toast.restoreFailed'),
        variant: 'destructive',
      });
    }
  }, [restoring, restore, prompt._id, toast, t]);

  const allVersions = useMemo<PromptVersionEntry[]>(() => {
    if (!history) return [];
    return [history.current, ...history.history];
  }, [history]);

  return (
    <>
      <Dialog
        open={open && !comparingVersion}
        onOpenChange={onOpenChange}
        title={t('history.dialogTitle', { name: prompt.title })}
        description={t('history.dialogDescription')}
        className="w-[95vw] max-w-[640px]"
      >
        {historyQuery.isLoading ? (
          <Text variant="muted" className="py-4 text-center text-sm">
            {t('history.loading')}
          </Text>
        ) : !history || allVersions.length === 0 ? (
          <Text variant="muted" className="py-4 text-center text-sm">
            {t('history.empty')}
          </Text>
        ) : (
          <ul className="divide-border max-h-[60vh] divide-y overflow-y-auto">
            {allVersions.map((entry, idx) => {
              const isCurrent = idx === 0;
              return (
                <li
                  key={entry.version}
                  className="flex items-center justify-between py-3"
                >
                  <div className="min-w-0 flex-1">
                    <HStack gap={2} align="center">
                      <Text variant="label" className="text-sm font-medium">
                        v{entry.version}
                      </Text>
                      {isCurrent && (
                        <Text
                          variant="muted"
                          className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 uppercase"
                        >
                          {t('history.current')}
                        </Text>
                      )}
                      <Text variant="muted" className="text-xs">
                        {formatDate(entry.publishedAt)}
                      </Text>
                    </HStack>
                    {entry.publishNote && (
                      <Text
                        variant="muted"
                        className="mt-0.5 line-clamp-1 text-xs italic"
                      >
                        {entry.publishNote}
                      </Text>
                    )}
                  </div>
                  <HStack gap={1}>
                    {!isCurrent && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setComparingVersion(entry)}
                        >
                          {t('history.compare')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setRestoring(entry)}
                        >
                          <RotateCcw className="mr-1 size-3" />
                          {t('history.restore')}
                        </Button>
                      </>
                    )}
                  </HStack>
                </li>
              );
            })}
          </ul>
        )}
      </Dialog>

      {comparingVersion && history && (
        <CompareDialog
          open={!!comparingVersion}
          onOpenChange={(o) => {
            if (!o) setComparingVersion(null);
          }}
          current={history.current}
          snapshot={comparingVersion}
          onRestore={() => setRestoring(comparingVersion)}
          isRestoring={restore.isPending}
          backLabel={t('history.backToList')}
          onBack={() => setComparingVersion(null)}
        />
      )}

      <ConfirmDialog
        open={!!restoring}
        onOpenChange={(o) => !o && setRestoring(null)}
        title={t('history.restoreConfirmTitle')}
        description={
          restoring
            ? t('history.restoreConfirmDescription', {
                source: String(restoring.version),
                target: String((prompt.version ?? 0) + 1),
              })
            : ''
        }
        confirmText={t('history.restore')}
        onConfirm={handleRestoreConfirm}
        isLoading={restore.isPending}
      />

      {/* Used implicitly via tCommon for cancel localization. */}
      <span className="sr-only">{tCommon('actions.cancel')}</span>
    </>
  );
}

interface CompareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: PromptVersionEntry;
  snapshot: PromptVersionEntry;
  onRestore: () => void;
  isRestoring: boolean;
  backLabel: string;
  onBack: () => void;
}

function CompareDialog({
  open,
  onOpenChange,
  current,
  snapshot,
  onRestore,
  isRestoring,
  backLabel,
  onBack,
}: CompareDialogProps) {
  const { t } = useT('prompts');

  const diff = useMemo(
    () =>
      differ.diff({ content: current.content }, { content: snapshot.content }),
    [current.content, snapshot.content],
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
      title={t('history.compareTitle', { version: String(snapshot.version) })}
      description={t('history.compareDescription', {
        date: new Date(snapshot.publishedAt).toLocaleString(),
      })}
      className="w-[95vw] max-w-[960px]"
      footer={
        <HStack gap={2} justify="between" className="w-full">
          <Button type="button" variant="ghost" onClick={onBack}>
            <ArrowLeft className="mr-1 size-4" />
            {backLabel}
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

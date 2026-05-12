'use client';

import { Button } from '@tale/ui/button';
import { RotateCcw } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { HStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useRestorePromptFromVersion } from '../hooks/mutations';
import type { PromptTemplate, PromptVersionEntry } from '../hooks/queries';
import { usePromptHistory } from '../hooks/queries';
import { PromptCompareDialog } from './prompt-compare-dialog';

interface PromptHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: PromptTemplate;
}

export function PromptHistoryDialog({
  open,
  onOpenChange,
  prompt,
}: PromptHistoryDialogProps) {
  const { t } = useT('prompts');
  const { toast } = useToast();
  const { formatDate } = useFormatDate();
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

  // Live restore target: prefer the freshest server state so the confirm
  // dialog doesn't drift if a concurrent edit lands while the dialog is open.
  const restoreTargetVersion =
    (history?.current.version ?? prompt.version ?? 0) + 1;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('history.dialogTitle', { name: prompt.title })}
        description={t('history.dialogDescription')}
        className="w-[95vw] max-w-[640px]"
      >
        {historyQuery.isLoading ? (
          <Text variant="muted" className="py-4 text-center text-sm">
            {t('history.loading')}
          </Text>
        ) : historyQuery.isError ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <Text variant="muted" className="text-sm">
              {t('history.loadFailed')}
            </Text>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => historyQuery.refetch()}
            >
              {t('history.retry')}
            </Button>
          </div>
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
                        {formatDate(new Date(entry.publishedAt), 'long')}
                      </Text>
                    </HStack>
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
        <PromptCompareDialog
          open={!!comparingVersion}
          onOpenChange={(o) => {
            if (!o) setComparingVersion(null);
          }}
          current={history.current}
          snapshot={comparingVersion}
          onRestore={() => setRestoring(comparingVersion)}
          isRestoring={restore.isPending}
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
                target: String(restoreTargetVersion),
              })
            : ''
        }
        confirmText={t('history.restore')}
        onConfirm={handleRestoreConfirm}
        isLoading={restore.isPending}
      />
    </>
  );
}

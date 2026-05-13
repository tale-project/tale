'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { RotateCcw } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { HStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useToast } from '@/app/hooks/use-toast';
import { MAX_PROMPT_VERSION_HISTORY } from '@/convex/prompts/constants';
import { useT } from '@/lib/i18n/client';

import { useRestorePromptFromVersion } from '../hooks/mutations';
import type { PromptTemplate, PromptVersionEntry } from '../hooks/queries';
import { usePromptHistory } from '../hooks/queries';
import { PromptCompareView } from './prompt-compare-view';

interface PromptHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: PromptTemplate;
}

const PREVIEW_CHARS = 80;

function previewSnippet(content: string): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= PREVIEW_CHARS) return collapsed;
  return `${collapsed.slice(0, PREVIEW_CHARS)}…`;
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

  // The dialog has two internal views: the list of versions, and a
  // compare-against-current view. Flattening these into one Dialog (instead
  // of nesting a second Dialog for compare) keeps focus-trap behavior sane
  // and Esc keypress unambiguous.
  const [comparingVersion, setComparingVersion] =
    useState<PromptVersionEntry | null>(null);
  const [restoring, setRestoring] = useState<PromptVersionEntry | null>(null);

  const handleRestoreConfirm = useCallback(async () => {
    if (!restoring || !history) return;
    try {
      await restore.mutateAsync({
        promptId: prompt._id,
        targetVersion: restoring.version,
        // OCC: refuse restore if the current version moved since the
        // dialog opened. Server throws `version_conflict`; we toast and
        // bail. Live `usePromptHistory` subscription will refresh on its
        // own and the user can retry.
        expectedVersion: history.current.version,
      });
      toast({
        title: t('toast.restored', { version: String(restoring.version) }),
        variant: 'success',
      });
      setRestoring(null);
      setComparingVersion(null);
    } catch (err) {
      console.error('[prompt-history] restore failed', err);
      const isConflict =
        err !== null &&
        typeof err === 'object' &&
        'data' in err &&
        err.data !== null &&
        typeof err.data === 'object' &&
        'code' in err.data &&
        (err.data as { code: unknown }).code === 'version_conflict';
      toast({
        title: isConflict ? t('toast.restoreStale') : t('toast.restoreFailed'),
        variant: 'destructive',
      });
      if (isConflict) {
        setRestoring(null);
      }
    }
  }, [restoring, history, restore, prompt._id, toast, t]);

  const allVersions = useMemo<PromptVersionEntry[]>(() => {
    if (!history) return [];
    return [history.current, ...history.history];
  }, [history]);

  // Stay reactive to fresh server state so the confirm copy doesn't drift if
  // a concurrent edit lands while the dialog is open.
  const restoreTargetVersion =
    (history?.current.version ?? prompt.version ?? 0) + 1;

  const dialogTitle = comparingVersion
    ? t('history.compareTitle', { version: String(comparingVersion.version) })
    : t('history.dialogTitle', { name: prompt.title });
  const dialogDescription = comparingVersion
    ? undefined
    : t('history.dialogDescription');

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={dialogTitle}
        description={dialogDescription}
        className="w-[95vw] max-w-[720px]"
      >
        {comparingVersion && history ? (
          <PromptCompareView
            current={history.current}
            snapshot={comparingVersion}
            onRestore={() => setRestoring(comparingVersion)}
            isRestoring={restore.isPending}
            onBack={() => setComparingVersion(null)}
          />
        ) : historyQuery.isLoading ? (
          <div className="flex flex-col gap-2 py-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="bg-muted h-12 animate-pulse rounded-md"
                aria-hidden="true"
              />
            ))}
            <span className="sr-only">{t('history.loading')}</span>
          </div>
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
          <>
            <ul className="divide-border max-h-[60vh] divide-y overflow-y-auto">
              {allVersions.map((entry, idx) => {
                const isCurrent = idx === 0;
                return (
                  <li
                    key={entry.version}
                    className="flex items-start justify-between gap-3 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <HStack gap={2} align="center">
                        <Text variant="label" className="text-sm font-medium">
                          v{entry.version}
                        </Text>
                        {isCurrent && (
                          <Badge variant="outline" className="text-[10px]">
                            {t('history.current')}
                          </Badge>
                        )}
                        <Text variant="muted" className="text-xs">
                          {entry.publishedByName
                            ? t('history.publishedByOn', {
                                name: entry.publishedByName,
                                date: formatDate(
                                  new Date(entry.publishedAt),
                                  'long',
                                ),
                              })
                            : formatDate(new Date(entry.publishedAt), 'long')}
                        </Text>
                      </HStack>
                      <Text
                        as="div"
                        variant="muted"
                        className="mt-1 line-clamp-1 text-xs"
                      >
                        {previewSnippet(entry.content)}
                      </Text>
                    </div>
                    <HStack gap={1} className="shrink-0">
                      {!isCurrent && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setComparingVersion(entry)}
                            aria-label={t('history.compareVersionAria', {
                              version: String(entry.version),
                            })}
                          >
                            {t('history.compare')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setRestoring(entry)}
                            aria-label={t('history.restoreVersionAria', {
                              version: String(entry.version),
                            })}
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
            {allVersions.length >= MAX_PROMPT_VERSION_HISTORY && (
              <Text variant="muted" className="px-1 pt-2 text-xs">
                {t('history.truncated', {
                  shown: String(allVersions.length),
                })}
              </Text>
            )}
          </>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!restoring}
        onOpenChange={(o) => !o && setRestoring(null)}
        title={
          restoring
            ? t('history.restoreConfirmTitleVersioned', {
                version: String(restoring.version),
              })
            : ''
        }
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

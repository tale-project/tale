'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { RotateCcw } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { HStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useRestorePromptFromVersion } from '../hooks/mutations';
import type { PromptTemplate, PromptVersionEntry } from '../hooks/queries';
import { usePromptHistory } from '../hooks/queries';
import { extractErrorCode } from '../lib/extract-error-code';
import { PromptCompareView } from './prompt-compare-view';
import { QueryErrorBlock } from './query-error-block';

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

/** Returns true if the entry's snapshot metadata differs from the current
 * version — used to surface a "metadata changed" badge on the row. */
function metadataChangedFromCurrent(
  entry: PromptVersionEntry,
  current: PromptVersionEntry,
): boolean {
  if (entry.title !== current.title) return true;
  if (entry.scope !== current.scope) return true;
  // Compare the structured id first; only fall back to the legacy
  // string when neither side has a stamped id (otherwise a lazy-migrate
  // write would falsely register as "no change" because the resolved
  // names match).
  if (entry.categoryId !== current.categoryId) return true;
  if (!entry.categoryId && !current.categoryId) {
    if (entry.category !== current.category) return true;
  }
  const aTags = entry.tags ?? [];
  const bTags = current.tags ?? [];
  if (aTags.length !== bTags.length) return true;
  return aTags.some((t, i) => t !== bTags[i]);
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
  // Restore captures BOTH the target entry AND the expectedVersion at the
  // moment the user opens the confirm. Reading `history.current.version` live
  // at confirm time would silently re-anchor the OCC token if a concurrent
  // edit lands between dialog open and confirm — exactly the scenario the
  // server's `restoreFromVersion` JSDoc claims to prevent.
  const [restoring, setRestoring] = useState<{
    entry: PromptVersionEntry;
    expectedVersion: number | undefined;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Reset transient state when the dialog closes so reopening doesn't pop a
  // stale Restore-confirm with an outdated `expectedVersion`. The query is
  // already skipped when `open=false`, but local state (`restoring`,
  // `comparingVersion`, `activeIndex`) survives unmounts because the parent
  // keeps this component mounted.
  useEffect(() => {
    if (!open) {
      setRestoring(null);
      setComparingVersion(null);
      setActiveIndex(0);
    }
  }, [open]);

  const startRestore = useCallback(
    (entry: PromptVersionEntry) => {
      setRestoring({ entry, expectedVersion: history?.current.version });
    },
    [history],
  );

  const allVersions = useMemo<PromptVersionEntry[]>(() => {
    if (!history) return [];
    return [history.current, ...history.history];
  }, [history]);

  // Keep the active index in-bounds when the list shrinks (e.g. after restore).
  useEffect(() => {
    if (activeIndex >= allVersions.length && allVersions.length > 0) {
      setActiveIndex(allVersions.length - 1);
    }
  }, [activeIndex, allVersions.length]);

  const handleRestoreConfirm = useCallback(async () => {
    if (!restoring) return;
    try {
      await restore.mutateAsync({
        promptId: prompt._id,
        targetVersion: restoring.entry.version,
        expectedVersion: restoring.expectedVersion,
      });
      toast({
        title: t('toast.restored', {
          version: String(restoring.entry.version),
        }),
        variant: 'success',
      });
      setRestoring(null);
      setComparingVersion(null);
    } catch (err) {
      const code = extractErrorCode(err);
      const isStale =
        code === 'version_conflict' || code === 'missing_expected_version';
      const toastKey = isStale
        ? 'toast.restoreStale'
        : code === 'forbidden'
          ? 'toast.forbidden'
          : code === 'not_found' || code === 'version_not_found'
            ? 'toast.notFound'
            : code === 'rate_limited'
              ? 'toast.rateLimited'
              : code === 'too_large'
                ? 'toast.tooLarge'
                : 'toast.restoreFailed';
      if (toastKey === 'toast.restoreFailed') {
        console.error('[prompt-history] restore failed', err);
      }
      toast({ title: t(toastKey), variant: 'destructive' });
      setRestoring(null);
      // If the snapshot we were comparing is now stale, close that view too
      // so the user lands back on the refreshed list.
      if (isStale) setComparingVersion(null);
    }
  }, [restoring, restore, prompt._id, toast, t]);

  const handleListKeyDown = useCallback(
    (e: KeyboardEvent<HTMLUListElement>) => {
      if (allVersions.length === 0) return;
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, allVersions.length - 1));
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          break;
        }
        case 'Home': {
          e.preventDefault();
          setActiveIndex(0);
          break;
        }
        case 'End': {
          e.preventDefault();
          setActiveIndex(allVersions.length - 1);
          break;
        }
        case 'Enter': {
          const entry = allVersions[activeIndex];
          if (entry && activeIndex !== 0) {
            e.preventDefault();
            // Shift+Enter restores, plain Enter compares. Mirrors the buttons
            // on the row — both actions are equally reachable by keyboard.
            if (e.shiftKey) {
              startRestore(entry);
            } else {
              setComparingVersion(entry);
            }
          }
          break;
        }
        case 'r':
        case 'R': {
          const entry = allVersions[activeIndex];
          if (entry && activeIndex !== 0) {
            e.preventDefault();
            startRestore(entry);
          }
          break;
        }
      }
    },
    [activeIndex, allVersions, startRestore],
  );

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

  const optionId = useCallback(
    (idx: number) => `prompt-version-option-${idx}`,
    [],
  );

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
            onRestore={() => startRestore(comparingVersion)}
            isRestoring={restore.isPending}
            onBack={() => setComparingVersion(null)}
          />
        ) : historyQuery.isLoading ? (
          <div
            className="flex flex-col gap-2 py-2"
            role="status"
            aria-busy="true"
          >
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
          <QueryErrorBlock
            message={t('history.loadFailed')}
            onRetry={() => historyQuery.refetch()}
          />
        ) : !history || allVersions.length === 0 ? (
          <Text variant="muted" className="py-4 text-center text-sm">
            {t('history.empty')}
          </Text>
        ) : (
          <>
            <ul
              role="listbox"
              aria-label={t('history.versionsLabel')}
              aria-activedescendant={optionId(activeIndex)}
              aria-keyshortcuts="Enter Shift+Enter R"
              tabIndex={0}
              onKeyDown={handleListKeyDown}
              className="divide-border focus-visible:ring-ring max-h-[60vh] divide-y overflow-y-auto rounded-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              {allVersions.map((entry, idx) => {
                const isCurrent = idx === 0;
                const isActive = idx === activeIndex;
                const metaChanged =
                  !isCurrent &&
                  history &&
                  metadataChangedFromCurrent(entry, history.current);
                return (
                  <li
                    key={entry.version}
                    id={optionId(idx)}
                    role="option"
                    aria-selected={isActive}
                    className={cn(
                      'flex items-start justify-between gap-3 px-2 py-3',
                      isActive && 'bg-muted/40',
                    )}
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
                        {metaChanged && (
                          <Badge variant="blue" className="text-[10px]">
                            {t('history.metadataChanged')}
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
                            onClick={() => startRestore(entry)}
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
            <Text variant="muted" className="mt-2 text-center text-[11px]">
              {t('history.keyboardHint')}
            </Text>
          </>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!restoring}
        onOpenChange={(o) => !o && setRestoring(null)}
        title={
          restoring
            ? t('history.restoreConfirmTitleVersioned', {
                version: String(restoring.entry.version),
              })
            : ''
        }
        description={
          restoring
            ? t('history.restoreConfirmDescription', {
                source: String(restoring.entry.version),
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

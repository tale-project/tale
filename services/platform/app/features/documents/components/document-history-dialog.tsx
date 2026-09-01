'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { ArrowLeft, ArrowRightLeft } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { ComparisonResults } from '@/app/features/documents/components/document-comparison/comparison-results';
import { useDocumentComparison } from '@/app/features/documents/hooks/use-document-comparison';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import type { BlobRef } from '@/backend/core/lib/storage/blob_ref';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useDocumentVersions } from '../hooks/queries';

interface DocumentHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  documentId: string | null;
  /** Display title while the query loads. */
  title?: string;
}

type VersionPick = {
  storageId: BlobRef;
  fileName: string;
};

type DocumentVersionRow = {
  storageId: BlobRef;
  createdAt: number;
  isCurrent: boolean;
  fileName?: string;
  size?: number;
  contentType?: string;
};

export function DocumentHistoryDialog({
  open,
  onOpenChange,
  organizationId,
  documentId,
  title: titleProp,
}: DocumentHistoryDialogProps) {
  const { t } = useT('documents');
  const { formatDate } = useFormatDate();
  const versionsQuery = useDocumentVersions(
    open ? (documentId ?? undefined) : undefined,
  );
  const { compare, result, error, isPending, reset } = useDocumentComparison({
    organizationId,
  });

  const [base, setBase] = useState<VersionPick | null>(null);
  const [compareTo, setCompareTo] = useState<VersionPick | null>(null);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    if (!open) {
      setBase(null);
      setCompareTo(null);
      setShowResults(false);
      reset();
    }
  }, [open, reset]);

  const versions: DocumentVersionRow[] = versionsQuery.data?.versions ?? [];
  const displayTitle =
    versionsQuery.data?.title ?? titleProp ?? t('preview.document');

  const fileNameFor = useCallback(
    (v: DocumentVersionRow) =>
      v.fileName ?? versionsQuery.data?.title ?? 'file',
    [versionsQuery.data?.title],
  );

  const togglePick = useCallback(
    (v: DocumentVersionRow) => {
      const pick: VersionPick = {
        storageId: v.storageId,
        fileName: fileNameFor(v),
      };
      setShowResults(false);
      reset();

      if (base?.storageId === pick.storageId) {
        setBase(null);
        return;
      }
      if (compareTo?.storageId === pick.storageId) {
        setCompareTo(null);
        return;
      }
      if (!base) {
        setBase(pick);
        return;
      }
      if (!compareTo) {
        setCompareTo(pick);
        return;
      }
      // Both set — replace compare target.
      setCompareTo(pick);
    },
    [base, compareTo, fileNameFor, reset],
  );

  const canCompare = Boolean(base && compareTo && !isPending);

  const handleCompare = useCallback(async () => {
    if (!base || !compareTo) return;
    try {
      await compare({
        baseStorageId: base.storageId,
        baseFileName: base.fileName,
        comparisonStorageId: compareTo.storageId,
        comparisonFileName: compareTo.fileName,
      });
      setShowResults(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('history.compareFailed');
      toast({
        title: t('history.compareFailed'),
        description: message,
        variant: 'destructive',
      });
    }
  }, [base, compareTo, compare, t]);

  const selectionHint = useMemo(() => {
    if (versions.length <= 1) return t('history.singleVersion');
    if (!base) return t('history.selectTwo');
    if (!compareTo) return t('history.selectAsCompare');
    return null;
  }, [versions.length, base, compareTo, t]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('history.dialogTitle', { name: displayTitle })}
      description={showResults ? undefined : t('history.dialogDescription')}
      size="wide"
    >
      {showResults && result ? (
        <Stack gap={3} className="pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={ArrowLeft}
            onClick={() => {
              setShowResults(false);
              reset();
            }}
          >
            {t('history.backToList')}
          </Button>
          <ComparisonResults result={result} />
        </Stack>
      ) : versionsQuery.isLoading ? (
        <Stack gap={2} className="py-2" role="status" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="bg-muted h-12 animate-pulse rounded-md"
              aria-hidden="true"
            />
          ))}
          <span className="sr-only">{t('history.loading')}</span>
        </Stack>
      ) : versionsQuery.isError || !versionsQuery.data ? (
        <Text variant="muted" className="py-4 text-center text-sm">
          {t('history.loadFailed')}
        </Text>
      ) : versions.length === 0 ? (
        <Text variant="muted" className="py-4 text-center text-sm">
          {t('history.empty')}
        </Text>
      ) : (
        <Stack gap={3} className="pt-2">
          <ul
            role="listbox"
            aria-label={t('history.versionsLabel')}
            aria-multiselectable="true"
            className="divide-border max-h-[40vh] divide-y overflow-y-auto rounded-md border"
          >
            {versions.map((v) => {
              const isBase = base?.storageId === v.storageId;
              const isCompare = compareTo?.storageId === v.storageId;
              const selected = isBase || isCompare;
              return (
                <li key={v.storageId} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    className={cn(
                      'hover:bg-muted/60 flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm',
                      selected && 'bg-muted',
                    )}
                    onClick={() => togglePick(v)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {t('history.versionLabel', {
                        date: formatDate(new Date(v.createdAt)),
                      })}
                    </span>
                    <HStack gap={1} className="shrink-0">
                      {v.isCurrent ? (
                        <Badge variant="outline">
                          {t('history.currentBadge')}
                        </Badge>
                      ) : null}
                      {isBase ? (
                        <Badge variant="blue">
                          {t('history.baseSelected')}
                        </Badge>
                      ) : null}
                      {isCompare ? (
                        <Badge variant="green">
                          {t('history.compareSelectedBadge')}
                        </Badge>
                      ) : null}
                    </HStack>
                  </button>
                </li>
              );
            })}
          </ul>

          {selectionHint ? (
            <Text variant="muted" className="text-sm">
              {selectionHint}
            </Text>
          ) : null}

          {error ? (
            <Text variant="error" className="text-sm">
              {error}
            </Text>
          ) : null}

          <HStack gap={2} justify="end">
            {isPending ? (
              <Spinner size="sm" label={t('history.comparing')} />
            ) : null}
            <Button
              type="button"
              onClick={() => void handleCompare()}
              disabled={!canCompare}
              isLoading={isPending}
              icon={ArrowRightLeft}
            >
              {t('history.compareSelected')}
            </Button>
          </HStack>
        </Stack>
      )}
    </Dialog>
  );
}

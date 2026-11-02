'use client';

import { Badge } from '@tale/ui/badge';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { cn } from '@tale/ui/cn';
import { ACTIONS_COLUMN_SIZE } from '@tale/ui/data-table/column-builders';
import { DataTable } from '@tale/ui/data-table/data-table';
import { EntityRowActions } from '@tale/ui/entity/entity-row-actions';
import { HStack } from '@tale/ui/layout';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import { DEFAULT_LIST_PAGE_SIZE, useListPage } from '@tale/ui/use-list-page';
import { toast } from '@tale/ui/use-toast';
import { Link } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeft, Eye, HardDrive, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { DocumentDeleteDialog } from '@/app/features/documents/components/document-delete-dialog';
import { DocumentPreviewDialog } from '@/app/features/documents/components/document-preview-dialog-lazy';
import { useDeleteDocument } from '@/app/features/documents/hooks/mutations';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useLegalHoldByTarget } from '@/app/features/settings/governance/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useListReadRecovery } from '@/app/hooks/use-list-read-recovery';
import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';
import { isAuthoredSourceProvider } from '@/lib/shared/document-source-providers';
import { formatBytes } from '@/lib/utils/format/number';

import { type UploadUsageFile, useUploadUsageFiles } from '../hooks/queries';

const linkClass =
  'text-foreground underline underline-offset-4 hover:text-primary';

/** The part of the meter each file counts in, as the list names it. */
const KIND_KEYS = {
  documents: 'usage.storage.files.kind.documents',
  chatAttachments: 'usage.storage.files.kind.chatAttachments',
  agentFiles: 'usage.storage.files.kind.agentFiles',
  other: 'usage.storage.files.kind.other',
} as const;

/**
 * The document a row may delete, or `null`. Delete is the document's own
 * delete, offered where Knowledge or the project's Files tab offers it: in
 * Knowledge a document that did not come from a sync (its `sourceMode`), in
 * a project one people authored (`isAuthoredSourceProvider`), not in Trash,
 * in a place the person can open that is not archived, to a role that
 * writes documents. A delete removes every version, so it is offered on the
 * document's current file alone. The server checks every rule again.
 */
function deletableDocumentId(
  file: UploadUsageFile,
  canWrite: boolean,
): string | null {
  const { document, place } = file;
  if (!canWrite || file.inTrash || document === null || !document.current) {
    return null;
  }
  if (place.type === 'knowledge') {
    return place.open && document.sourceMode === 'manual' ? document.id : null;
  }
  if (place.type === 'project') {
    return place.open &&
      !place.archived &&
      isAuthoredSourceProvider(document.sourceProvider)
      ? document.id
      : null;
  }
  return null;
}

interface UsageFilesProps {
  organizationId: string;
}

/**
 * Settings › Usage › Storage files: every file the person uploaded that
 * counts toward their storage limit, largest first — the rows the meter
 * adds up — with where each lives, and Open and Delete where they may.
 */
export function UsageFiles({ organizationId }: UsageFilesProps) {
  const { t } = useT('settings');
  const { locale } = useFormatNumber();
  const ability = useAbility();
  const canWrite = ability.can('write', 'knowledgeWrite');

  const result = useUploadUsageFiles(organizationId, DEFAULT_LIST_PAGE_SIZE);
  const recovery = useListReadRecovery(result);

  const columns = useMemo<ColumnDef<UploadUsageFile>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('usage.storage.files.columns.name'),
        cell: ({ row }) => (
          <HStack gap={2} className="min-w-0">
            <Text as="span" truncate title={row.original.name}>
              {row.original.name}
            </Text>
            {row.original.inTrash && (
              <Badge variant="outline" className="shrink-0">
                {t('usage.storage.files.inTrash')}
              </Badge>
            )}
          </HStack>
        ),
        size: 260,
      },
      {
        accessorKey: 'kind',
        header: t('usage.storage.files.columns.kind'),
        cell: ({ row }) => t(KIND_KEYS[row.original.kind]),
        size: 160,
      },
      {
        id: 'place',
        header: t('usage.storage.files.columns.place'),
        cell: ({ row }) => (
          <FilePlace organizationId={organizationId} file={row.original} />
        ),
        size: 200,
      },
      {
        accessorKey: 'size',
        header: t('usage.storage.files.columns.size'),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatBytes(row.original.size, locale)}
          </span>
        ),
        size: 100,
      },
      {
        accessorKey: 'createdAt',
        header: t('usage.storage.files.columns.uploaded'),
        cell: ({ row }) => <TableDateCell date={row.original.createdAt} />,
        size: 120,
      },
      {
        id: 'actions',
        header: '',
        meta: { isAction: true },
        size: ACTIONS_COLUMN_SIZE,
        enableSorting: false,
        cell: ({ row }) => (
          <HStack justify="end">
            <StorageFileActions
              organizationId={organizationId}
              file={row.original}
              canWrite={canWrite}
            />
          </HStack>
        ),
      },
    ],
    [t, locale, organizationId, canWrite],
  );

  const list = useListPage<UploadUsageFile>({
    dataSource: {
      type: 'paginated',
      results: result.results,
      status: result.status,
      loadMore: result.loadMore,
      isLoading: result.isLoading,
      error: result.error,
      retry: recovery.retryRead,
      // A failed read stops the list where it stands, also when its last
      // page was already in: the footer never claims "Showing all" then.
      loadFailed: result.error !== null,
    },
    pageSize: DEFAULT_LIST_PAGE_SIZE,
    // No search and no sort: the server pages the files largest first, and
    // a search or sort over the loaded rows would misstate the rest.
    getRowId: (row) => row.id,
    entityLabel: {
      one: t('usage.storage.files.entityLabelOne'),
      other: t('usage.storage.files.entityLabel'),
    },
  });

  return (
    <SettingsPage>
      <Link
        to="/dashboard/$id/settings/usage"
        params={{ id: organizationId }}
        className={cn('inline-flex items-center gap-1 self-start', linkClass)}
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('usage.storage.files.back')}
      </Link>
      <SettingsSection
        ref={recovery.regionRef}
        tabIndex={-1}
        title={t('usage.storage.files.title')}
        description={t('usage.storage.files.description')}
      >
        {recovery.failedWithRows && (
          <CatalogLoadError
            message={t('usage.storage.files.loadFailed')}
            onRetry={recovery.retryRead}
            isRetrying={result.isRetrying}
            failureKey={result.errorCount}
            onFocusLost={recovery.focusRegion}
          />
        )}
        <DataTable<UploadUsageFile>
          columns={columns}
          onErrorFocusLost={recovery.focusRegion}
          emptyState={{
            icon: HardDrive,
            title: t('usage.storage.files.empty.title'),
            description: t('usage.storage.files.empty.description'),
          }}
          caption={t('usage.storage.files.caption')}
          {...list.tableProps}
        />
      </SettingsSection>
    </SettingsPage>
  );
}

/**
 * Where a file lives, linked when the person may go there now: a library
 * document opens in Knowledge, a project's in its Files tab, a chat file in
 * the chat. A place they cannot reach is named as such, never by its name.
 */
function FilePlace({
  organizationId,
  file,
}: {
  organizationId: string;
  file: UploadUsageFile;
}) {
  const { t } = useT('settings');
  const { t: tChat } = useT('chat');
  const { place } = file;
  const documentId = file.document?.id;

  if (place.type === 'knowledge') {
    const label = t('usage.storage.files.place.knowledge');
    return place.open ? (
      <Link
        to="/dashboard/$id/documents"
        params={{ id: organizationId }}
        search={documentId === undefined ? {} : { doc: documentId }}
        className={linkClass}
      >
        {label}
      </Link>
    ) : (
      <Text as="span">{label}</Text>
    );
  }
  if (place.type === 'project') {
    if (place.id === null) {
      return (
        <Text as="span" variant="muted">
          {t('usage.storage.files.place.hiddenProject')}
        </Text>
      );
    }
    const name = place.name ?? place.id;
    return (
      <HStack gap={2} className="min-w-0">
        {place.open ? (
          <Link
            to="/dashboard/$id/projects/$projectId/files"
            params={{ id: organizationId, projectId: place.id }}
            search={documentId === undefined ? {} : { doc: documentId }}
            className={cn('truncate', linkClass)}
            title={name}
          >
            {name}
          </Link>
        ) : (
          <Text as="span" truncate title={name}>
            {name}
          </Text>
        )}
        {place.archived && (
          <Badge variant="outline" className="shrink-0">
            {t('usage.storage.files.archived')}
          </Badge>
        )}
      </HStack>
    );
  }
  if (place.type === 'chat') {
    if (place.id === null) {
      return (
        <Text as="span" variant="muted">
          {t('usage.storage.files.place.hiddenChat')}
        </Text>
      );
    }
    const title = place.title ?? tChat('history.untitled');
    return place.open ? (
      <Link
        to="/dashboard/$id/chat/$threadId"
        params={{ id: organizationId, threadId: place.id }}
        className={cn('block truncate', linkClass)}
        title={title}
      >
        {title}
      </Link>
    ) : (
      <Text as="span" truncate title={title}>
        {title}
      </Text>
    );
  }
  return (
    <Text as="span" variant="muted">
      {t('usage.storage.files.place.none')}
    </Text>
  );
}

/**
 * Open and Delete for one file. A file in Trash has neither: it no longer
 * opens, and only Trash's purge removes it. A legal hold or a protected
 * record leaves Delete unavailable with its reason, as Knowledge does.
 */
function StorageFileActions({
  organizationId,
  file,
  canWrite,
}: {
  organizationId: string;
  file: UploadUsageFile;
  canWrite: boolean;
}) {
  const { t } = useT('settings');
  const { t: tDocuments } = useT('documents');
  const { t: tLegalHold } = useT('legalHold');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { mutateAsync: deleteDocument, isPending: isDeleting } =
    useDeleteDocument();
  const documentId = deletableDocumentId(file, canWrite);
  const { data: legalHold } = useLegalHoldByTarget({
    organizationId,
    targetType: 'document',
    targetId: documentId ?? undefined,
  });
  const isHeld = legalHold !== null && legalHold !== undefined;
  const isRecordProtected = file.document?.recordProtected === true;

  // The delete refreshes every `document` read, the meter and this list
  // among them, so the file leaves the list and the meter goes down.
  const handleDeleteConfirm = useCallback(() => {
    if (documentId === null) return;
    void deleteDocument({ documentId }).then(
      () => setConfirmDelete(false),
      (error: unknown) => {
        console.error(
          'Failed to delete a document from the storage list:',
          error,
        );
        toast({
          title: tDocuments('actions.deleteFileFailed'),
          description: failureDetail(error),
          variant: 'destructive',
        });
      },
    );
  }, [deleteDocument, documentId, tDocuments]);

  if (file.inTrash) return null;

  return (
    <>
      <EntityRowActions
        triggerRef={triggerRef}
        actions={[
          {
            key: 'open',
            label: t('usage.storage.files.open'),
            icon: Eye,
            onClick: () => setPreviewOpen(true),
          },
          {
            key: 'delete',
            label: isHeld
              ? tLegalHold('blockedByHold')
              : isRecordProtected
                ? tDocuments('record.blockedByRecord')
                : t('usage.storage.files.delete'),
            icon: Trash2,
            onClick: () => setConfirmDelete(true),
            destructive: true,
            visible: documentId !== null,
            disabled: isHeld || isRecordProtected,
          },
        ]}
      />
      {previewOpen && (
        <DocumentPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          fileId={file.storageRef}
          fileName={file.name}
          restoreFocusRef={triggerRef}
        />
      )}
      {documentId !== null && (
        <DocumentDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          onConfirmDelete={handleDeleteConfirm}
          isLoading={isDeleting}
          fileName={file.document?.title ?? file.name}
        />
      )}
    </>
  );
}

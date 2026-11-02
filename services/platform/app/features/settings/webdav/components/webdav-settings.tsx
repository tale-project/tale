'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { CopyableField } from '@tale/ui/copyable-field';
import { DataTable } from '@tale/ui/data-table/data-table';
import { DeleteDialog } from '@tale/ui/dialog/delete-dialog';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { Stack } from '@tale/ui/layout';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import { DEFAULT_LIST_PAGE_SIZE, useListPage } from '@tale/ui/use-list-page';
import { useToast } from '@tale/ui/use-toast';
import type { ColumnDef } from '@tanstack/react-table';
import { Key, KeyRound, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { extractErrorCode } from '@/app/features/shared/lib/extract-error-code';
import { useListReadRecovery } from '@/app/hooks/use-list-read-recovery';
import { useAuth } from '@/app/hooks/use-session-user';
import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import {
  useCreateWebdavAppPassword,
  useRevokeWebdavAppPassword,
  useWebdavAppPasswords,
  type WebdavAppPasswordRow,
} from '../hooks/use-webdav-app-passwords';

interface WebdavSettingsProps {
  organizationId: string;
  orgSlug: string;
  siteOrigin: string;
}

type RevealedPassword = { password: string; prefix: string } | null;

/**
 * WebDAV settings — rebuilt on the shared settings UI (SettingsSection,
 * CopyableField, DataTable, FormDialog, DeleteDialog) so it matches every
 * other settings page instead of carrying bespoke table / form / copy chrome.
 *
 * A failed list read is never a skeleton that never ends (#4652): with no
 * app-password loaded the table shows its error state with Try again, which
 * moves the focus to the list's section before the table turns back into its
 * loading state; rows a failed refresh left stay, still revocable, and the
 * failure is named above them.
 */
export function WebdavSettings(props: WebdavSettingsProps) {
  const { t } = useT('webdav');
  const { user } = useAuth();
  const { rows, error, retry, retrying, failureCount } = useWebdavAppPasswords(
    props.organizationId,
  );
  const { regionRef, retryRead, focusRegion, failedWithRows } =
    useListReadRecovery<HTMLElement>({ error, results: rows ?? [], retry });
  const [createOpen, setCreateOpen] = useState(false);
  const [revealed, setRevealed] = useState<RevealedPassword>(null);

  const url = `${props.siteOrigin}/dav/${props.orgSlug}/documents/`;

  return (
    <>
      <SettingsSection
        title={t('connectionDetails.title')}
        description={t('description')}
      >
        {/* Same divided rows as every settings section — label + hint left,
            value pinned right. */}
        <SettingsFieldList>
          <SettingsFieldRow label="URL">
            <CopyableField value={url} mono />
          </SettingsFieldRow>
          <SettingsFieldRow
            label={t('connectionDetails.usernameLabel')}
            description={t('connectionDetails.usernameHelp')}
          >
            <CopyableField
              value={user?.email ?? ''}
              copyAriaLabel={t('connectionDetails.copyUsername')}
            />
          </SettingsFieldRow>
        </SettingsFieldList>
        {/* Not a field — a pointer at the app-passwords table below, which is
            where the credential actually lives. */}
        <Stack gap={1}>
          <Text as="span" variant="label">
            {t('connectionDetails.passwordLabel')}
          </Text>
          <Text as="span" variant="muted" className="text-sm">
            {t('connectionDetails.passwordHelp')}
          </Text>
        </Stack>
      </SettingsSection>

      <SettingsSection
        ref={regionRef}
        title={t('list.title')}
        description={t('create.description')}
        // The focus of a Try again that gave way lands on this named section,
        // not on the page. A revoke's lands here only when the table has
        // nothing left to hold it (`DataTable`'s last resort): a revoked row
        // stays without its Revoke button, so the focus that button held
        // goes to the next row's, else to the table's Generate.
        tabIndex={-1}
        className="outline-none"
      >
        {failedWithRows && (
          <CatalogLoadError
            // Each failure is announced again; Try again keeps its node, and
            // the focus on it, while a retry runs and when it fails again.
            failureKey={failureCount}
            onFocusLost={focusRegion}
            message={t('list.refreshFailed')}
            onRetry={retry}
            isRetrying={retrying}
          />
        )}
        <WebdavAppPasswordsTable
          rows={rows}
          error={error}
          onRetry={retryRead}
          onErrorFocusLost={focusRegion}
          onCreate={() => setCreateOpen(true)}
        />
      </SettingsSection>

      <CreateAppPasswordDialog
        organizationId={props.organizationId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={setRevealed}
      />
      <RevealedPasswordDialog
        revealed={revealed}
        onClose={() => setRevealed(null)}
      />
    </>
  );
}

/**
 * The app-passwords as every settings list shows its rows (`useListPage`):
 * a window of `DEFAULT_LIST_PAGE_SIZE` that grows as the reader scrolls, a
 * search and Generate in the table's own toolbar, and the shared count
 * footer.
 */
function WebdavAppPasswordsTable({
  rows,
  error,
  onRetry,
  onErrorFocusLost,
  onCreate,
}: {
  rows: WebdavAppPasswordRow[] | undefined;
  /** The list read's settled failure. With no app-password loaded the table
   * shows its error state with `onRetry`; rows already loaded stay, and the
   * section names the failure above them. */
  error: Error | null;
  onRetry: () => void;
  /** Takes the focus the error state held when a refresh replaces it. */
  onErrorFocusLost: () => void;
  /** Opens the create dialog: the table's Generate. */
  onCreate: () => void;
}) {
  const { t } = useT('webdav');

  // Newest first — the just-generated row is the one users most want to
  // find, so the first window holds the newest. A read that has not
  // answered stays `undefined`: pending, or failed — the table's skeleton
  // or its error state then; never an empty list.
  const sortedRows = useMemo(
    () =>
      rows === undefined
        ? undefined
        : [...rows].sort((a, b) => b.createdAt - a.createdAt),
    [rows],
  );

  const list = useListPage<WebdavAppPasswordRow>({
    dataSource: { type: 'query', data: sortedRows, error, retry: onRetry },
    pageSize: DEFAULT_LIST_PAGE_SIZE,
    // The two texts a row shows: its label, and the prefix that tells two
    // passwords apart.
    search: {
      fields: ['label', 'prefix'],
      placeholder: t('list.searchPlaceholder'),
    },
    getRowId: (row) => row._id,
    approxRowCount: 3,
    entityLabel: {
      one: t('list.entityLabelOne'),
      other: t('list.entityLabel'),
    },
  });

  const columns = useMemo<ColumnDef<WebdavAppPasswordRow>[]>(
    () => [
      {
        accessorKey: 'label',
        header: t('list.label'),
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-2">
            <Text as="span" variant="label">
              {row.original.label}
            </Text>
            {row.original.revokedAt != null && (
              <Badge variant="outline" className="shrink-0">
                {t('list.revoked')}
              </Badge>
            )}
          </span>
        ),
      },
      // Column sizes double as the table's min-width floor (DataTable sums
      // them) — keep the total within the full-width settings page budget
      // (≤ 940px) so the table never forces horizontal scroll.
      {
        accessorKey: 'prefix',
        header: t('list.prefix'),
        size: 100,
        cell: ({ row }) => (
          <Text as="span" variant="muted" className="font-mono text-xs">
            {row.original.prefix}…
          </Text>
        ),
      },
      {
        id: 'lastUsed',
        header: t('list.lastUsed'),
        size: 152,
        meta: { align: 'right' },
        cell: ({ row }) => (
          <TableDateCell
            date={row.original.lastUsedAt}
            preset="short"
            alignRight
            emptyText={t('list.neverUsed')}
          />
        ),
      },
      {
        id: 'created',
        header: t('list.created'),
        size: 123,
        meta: { align: 'right' },
        cell: ({ row }) => (
          <TableDateCell
            date={row.original.createdAt}
            preset="short"
            alignRight
          />
        ),
      },
      {
        id: 'actions',
        size: 44,
        meta: { isAction: true },
        cell: ({ row }) => <WebdavRowActions row={row.original} />,
      },
    ],
    [t],
  );

  return (
    <DataTable
      columns={columns}
      caption={t('list.title')}
      // The standard create affordance: DataTable sizes and places it like
      // every other list's, in the toolbar beside the search.
      addAction={{
        label: t('create.submit'),
        icon: KeyRound,
        onClick: onCreate,
      }}
      onErrorFocusLost={onErrorFocusLost}
      emptyState={{
        icon: Key,
        title: t('list.empty'),
        description: t('list.emptyDescription'),
      }}
      {...list.tableProps}
    />
  );
}

function WebdavRowActions({ row }: { row: WebdavAppPasswordRow }) {
  const { t } = useT('webdav');
  const { toast } = useToast();
  const revoke = useRevokeWebdavAppPassword();
  const [open, setOpen] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  if (row.revokedAt != null) return null;

  const handleRevoke = async () => {
    if (isRevoking) return;
    setIsRevoking(true);
    try {
      await revoke({ id: row._id });
      toast({ title: t('list.revokedToast') });
      setOpen(false);
    } catch (err) {
      console.error('webdav: revoke app-password failed', err);
      const code = extractErrorCode(err);
      toast({
        title:
          code === 'NOT_FOUND'
            ? t('list.revokeErrorNotFound')
            : t('list.revokeError'),
        // A gone password is the whole story; any other refusal says why.
        description: code === 'NOT_FOUND' ? undefined : failureDetail(err),
        variant: 'destructive',
      });
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        icon={Trash2}
        title={t('list.revoke')}
        disabled={isRevoking}
        onClick={() => setOpen(true)}
      />
      <DeleteDialog
        open={open}
        onOpenChange={setOpen}
        title={t('revokeDialog.title')}
        description={t('revokeDialog.body')}
        deleteText={t('revokeDialog.confirm')}
        cancelText={t('revokeDialog.cancel')}
        isDeleting={isRevoking}
        onDelete={handleRevoke}
      />
    </>
  );
}

function CreateAppPasswordDialog(props: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (revealed: NonNullable<RevealedPassword>) => void;
}) {
  const { t } = useT('webdav');
  const { toast } = useToast();
  const [label, setLabel] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const create = useCreateWebdavAppPassword();

  // Never let a label leak across org switches.
  useEffect(() => () => setLabel(''), [props.organizationId]);

  const reset = () => setLabel('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed || isCreating) return;
    setIsCreating(true);
    try {
      const result = await create({
        organizationId: props.organizationId,
        label: trimmed,
      });
      props.onCreated(result);
      reset();
      props.onOpenChange(false);
    } catch (err) {
      console.error('webdav: create app-password failed', err);
      const code = extractErrorCode(err);
      const known =
        code === 'LIMIT_EXCEEDED'
          ? t('create.errorLimit')
          : code === 'rate_limited'
            ? t('create.errorRateLimited')
            : undefined;
      toast({
        title: known ?? t('create.error'),
        // A refusal named above is the whole story; any other says why.
        description: known === undefined ? failureDetail(err) : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <FormDialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) reset();
        props.onOpenChange(next);
      }}
      title={t('create.title')}
      description={t('create.description')}
      submitText={t('create.submit')}
      isSubmitting={isCreating}
      isDirty={label.trim().length > 0}
      onSubmit={handleSubmit}
    >
      <Input
        id="webdav-label"
        label={t('create.labelLabel')}
        placeholder={t('create.labelPlaceholder')}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={64}
        disabled={isCreating}
        required
      />
    </FormDialog>
  );
}

function RevealedPasswordDialog(props: {
  revealed: RevealedPassword;
  onClose: () => void;
}) {
  const { t } = useT('webdav');
  const open = props.revealed !== null;
  const password = props.revealed?.password ?? '';

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      title={t('create.savedTitle')}
      isSubmitting={false}
      onSubmit={(e) => {
        e.preventDefault();
        props.onClose();
      }}
      customFooter={
        <Button type="button" onClick={props.onClose}>
          {t('create.dismiss')}
        </Button>
      }
    >
      <Text as="p" variant="muted" className="text-sm">
        {t('create.description')}
      </Text>
      <CopyableField value={password} mono copyAriaLabel={t('create.copy')} />
    </FormDialog>
  );
}

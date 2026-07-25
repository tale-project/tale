'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { Key, KeyRound, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { CopyableField } from '@/app/components/ui/data-display/copyable-field';
import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { extractErrorCode } from '@/app/features/shared/lib/extract-error-code';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  useCreateWebdavAppPassword,
  useRevokeWebdavAppPassword,
  useWebdavAppPasswords,
  type WebdavAppPasswordId,
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
 */
export function WebdavSettings(props: WebdavSettingsProps) {
  const { t } = useT('webdav');
  const { user } = useAuth();
  const rows = useWebdavAppPasswords(props.organizationId);
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
        title={t('list.title')}
        description={t('create.description')}
        action={
          <Button icon={KeyRound} onClick={() => setCreateOpen(true)}>
            {t('create.submit')}
          </Button>
        }
      >
        <WebdavAppPasswordsTable rows={rows} />
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

function WebdavAppPasswordsTable({
  rows,
}: {
  rows: WebdavAppPasswordRow[] | undefined;
}) {
  const { t } = useT('webdav');
  const isLoading = rows === undefined;

  // Newest first — the just-generated row is the one users most want to find.
  const sortedRows = useMemo(
    () => (rows ? [...rows].sort((a, b) => b.createdAt - a.createdAt) : []),
    [rows],
  );

  const columns = useMemo<ColumnDef<WebdavAppPasswordRow>[]>(
    () => [
      {
        accessorKey: 'label',
        header: t('list.label'),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <Text as="span" variant="label">
              {row.original.label}
            </Text>
            {row.original.revokedAt !== undefined && (
              <Badge variant="outline">{t('list.revoked')}</Badge>
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
        size: 123,
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
      data={sortedRows}
      isLoading={isLoading}
      approxRowCount={3}
      getRowId={(row) => row._id}
      emptyState={{ icon: Key, title: t('list.empty') }}
    />
  );
}

function WebdavRowActions({ row }: { row: WebdavAppPasswordRow }) {
  const { t } = useT('webdav');
  const { toast } = useToast();
  const revoke = useRevokeWebdavAppPassword();
  const [open, setOpen] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  if (row.revokedAt !== undefined) return null;

  const handleRevoke = async () => {
    if (isRevoking) return;
    setIsRevoking(true);
    try {
      await revoke({ id: row._id as WebdavAppPasswordId });
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
      const title =
        code === 'LIMIT_EXCEEDED'
          ? t('create.errorLimit')
          : code === 'rate_limited'
            ? t('create.errorRateLimited')
            : t('create.error');
      toast({ title, variant: 'destructive' });
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

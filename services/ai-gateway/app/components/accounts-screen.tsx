import { Badge } from '@tale/ui/badge';
import { ContentArea } from '@tale/ui/content-area';
import { ACTIONS_COLUMN_SIZE } from '@tale/ui/data-table/column-builders';
import { DataTable } from '@tale/ui/data-table/data-table';
import { TableIconCell } from '@tale/ui/data-table/table-icon-cell';
import { DeleteDialog } from '@tale/ui/dialog/delete-dialog';
import { EntityRowActions } from '@tale/ui/entity/entity-row-actions';
import { PageLayout } from '@tale/ui/page-layout';
import { StatusIndicator } from '@tale/ui/status-indicator';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useToast } from '@tale/ui/use-toast';
import type { ColumnDef } from '@tanstack/react-table';
import { Copy, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import {
  gatewayApi,
  type AccountStatus,
  type AccountView,
  type ProviderId,
} from '@/app/lib/api';
import { useT } from '@/lib/i18n/client';

import { AddAccountDialog, type AddAccountTarget } from './add-account-dialog';
import { PanelHeader } from './panel-header';
import { ProviderMark } from './provider-mark';
import { UsageCell } from './usage-cell';

const STATUS_VARIANT = {
  active: 'success',
  // An expired credential is a chore, not a fault: someone re-authenticates
  // it and the pool is whole again. A failed call is the alarming one.
  expired: 'warning',
  error: 'error',
} as const satisfies Record<AccountStatus, string>;

interface AccountsScreenProps {
  accounts: AccountView[];
  providers: ProviderId[];
  isLoading: boolean;
  error: Error | null;
  onReload: () => void;
}

/**
 * The panel's one collection screen: every pooled subscription, its status,
 * how much of its plan is spent, and how long its access token is still good
 * for. Row actions cover the three things an operator does to an account —
 * take its CLI command, re-authenticate it, remove it.
 */
export function AccountsScreen({
  accounts,
  providers,
  isLoading,
  error,
  onReload,
}: AccountsScreenProps) {
  const { t } = useT('accounts');
  const { t: tProviders } = useT('providers');
  const { t: tStatus } = useT('status');
  const { formatDate } = useFormatDate();
  const { toast } = useToast();

  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<AddAccountTarget | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<AccountView | null>(
    null,
  );

  const copyCommand = useCallback(
    async (account: AccountView) => {
      try {
        const command = await gatewayApi.command(account.id);
        await navigator.clipboard.writeText(command);
        toast({ description: t('commandCopied', { label: account.label }) });
      } catch (cause) {
        console.error('[ai-gateway] copying the CLI command failed:', cause);
        toast({ description: t('commandFailed'), variant: 'destructive' });
      }
    },
    [t, toast],
  );

  const remove = useCallback(
    async (account: AccountView) => {
      try {
        await gatewayApi.remove(account.id);
        toast({ description: t('removed', { label: account.label }) });
        onReload();
      } catch (cause) {
        console.error('[ai-gateway] removing the account failed:', cause);
        toast({ description: t('removeFailed'), variant: 'destructive' });
      }
    },
    [onReload, t, toast],
  );

  const columns = useMemo<ColumnDef<AccountView>[]>(
    () => [
      {
        id: 'account',
        accessorFn: (account) => account.label,
        header: t('columns.account'),
        meta: { flex: 2 },
        cell: ({ row }) => {
          const { accountEmail, label, plan, provider } = row.original;
          return (
            <TableIconCell
              badges={plan ? <Badge variant="slate">{plan}</Badge> : undefined}
              // The mark is the only other thing naming the provider, and it
              // is decorative — so the caption carries that name in text, plus
              // the address whenever the label is not already it.
              caption={
                accountEmail && accountEmail !== label
                  ? `${tProviders(provider)} · ${accountEmail}`
                  : tProviders(provider)
              }
              icon={<ProviderMark provider={provider} />}
              label={label}
              title={label}
              variant="plain"
            />
          );
        },
      },
      {
        id: 'status',
        accessorFn: (account) => account.status,
        header: t('columns.status'),
        cell: ({ row }) => (
          <StatusIndicator variant={STATUS_VARIANT[row.original.status]}>
            {tStatus(row.original.status)}
          </StatusIndicator>
        ),
      },
      {
        id: 'usage',
        header: t('columns.usage'),
        meta: { flex: 2 },
        cell: ({ row }) => (
          <UsageCell windows={row.original.usage?.windows ?? []} />
        ),
      },
      {
        id: 'token',
        accessorFn: (account) => account.expiresAt,
        header: t('columns.token'),
        cell: ({ row }) => (
          <Text variant="caption">
            {row.original.expiresAt
              ? t('validUntil', {
                  date: formatDate(row.original.expiresAt, 'short'),
                })
              : t('noExpiry')}
          </Text>
        ),
      },
      {
        id: 'actions',
        size: ACTIONS_COLUMN_SIZE,
        meta: { isAction: true },
        header: () => <span className="sr-only">{t('columns.actions')}</span>,
        cell: ({ row }) => (
          <EntityRowActions
            actions={[
              {
                key: 'copy',
                icon: Copy,
                label: t('actions.copyCommand'),
                onClick: () => void copyCommand(row.original),
              },
              {
                key: 'reauthenticate',
                icon: RefreshCw,
                label: t('actions.reauthenticate'),
                onClick: () => setDialog({ account: row.original }),
              },
              {
                key: 'remove',
                destructive: true,
                icon: Trash2,
                label: t('actions.remove'),
                onClick: () => setPendingRemoval(row.original),
                separator: true,
              },
            ]}
            ariaLabel={t('actions.menu')}
          />
        ),
      },
    ],
    [copyCommand, formatDate, t, tProviders, tStatus],
  );

  // `DataTable` renders the `Error` it is handed, so the sentence a reader
  // sees has to be the translated one rather than whatever the API wrote.
  const loadError = useMemo(
    () => (error ? new Error(t('loadFailed')) : null),
    [error, t],
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return accounts;
    return accounts.filter((account) =>
      [
        account.label,
        account.accountEmail ?? '',
        tProviders(account.provider),
      ].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [accounts, query, tProviders]);

  return (
    <PageLayout header={<PanelHeader />}>
      <ContentArea variant="list">
        <DataTable
          addAction={{
            icon: KeyRound,
            label: t('add'),
            onClick: () => setDialog({ account: null }),
          }}
          approxRowCount={accounts.length || undefined}
          caption={t('caption')}
          columns={columns}
          data={rows}
          emptyState={{
            title: t('empty.title'),
            description: t('empty.description'),
          }}
          error={loadError}
          getRowId={(account) => account.id}
          isLoading={isLoading}
          onRetry={onReload}
          pagination={{
            clientSide: true,
            entityLabel: { one: t('entity.one'), other: t('entity.other') },
          }}
          search={{
            value: query,
            onChange: setQuery,
            placeholder: t('searchPlaceholder'),
          }}
          stickyLayout
        />
      </ContentArea>

      <AddAccountDialog
        onConnected={onReload}
        providers={providers}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        open={dialog !== null}
        target={dialog ?? { account: null }}
      />

      <DeleteDialog
        deleteText={t('removeConfirm')}
        description={t('removeDescription')}
        onDelete={() => {
          const account = pendingRemoval;
          setPendingRemoval(null);
          if (account) void remove(account);
        }}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
        open={pendingRemoval !== null}
        title={t('removeTitle', { label: pendingRemoval?.label ?? '' })}
      />
    </PageLayout>
  );
}

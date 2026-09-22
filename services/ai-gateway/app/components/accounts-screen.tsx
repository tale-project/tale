import { Badge } from '@tale/ui/badge';
import { ContentArea } from '@tale/ui/content-area';
import { ACTIONS_COLUMN_SIZE } from '@tale/ui/data-table/column-builders';
import { DataTable } from '@tale/ui/data-table/data-table';
import {
  TableIconCell,
  tableIconCellSkeleton,
} from '@tale/ui/data-table/table-icon-cell';
import { DeleteDialog } from '@tale/ui/dialog/delete-dialog';
import { EntityRowActions } from '@tale/ui/entity/entity-row-actions';
import { PageLayout } from '@tale/ui/page-layout';
import { SkipLink } from '@tale/ui/skip-link';
import { StatusIndicator } from '@tale/ui/status-indicator';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useToast } from '@tale/ui/use-toast';
import type { ColumnDef } from '@tanstack/react-table';
import { Copy, KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react';
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
  const { t: tPanel } = useT('panel');
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
        toast({
          title: t('commandCopied', { label: account.label }),
          variant: 'success',
        });
      } catch (cause) {
        console.error('[ai-gateway] copying the CLI command failed:', cause);
        toast({ title: t('commandFailed'), variant: 'destructive' });
      }
    },
    [t, toast],
  );

  const remove = useCallback(
    async (account: AccountView) => {
      try {
        await gatewayApi.remove(account.id);
        toast({
          title: t('removed', { label: account.label }),
          variant: 'success',
        });
        onReload();
      } catch (cause) {
        console.error('[ai-gateway] removing the account failed:', cause);
        toast({ title: t('removeFailed'), variant: 'destructive' });
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
        // The one column that grows: a name, a plan badge and a caption
        // carrying the provider plus an e-mail address need every pixel the
        // fixed siblings leave over. `size` is its readable floor, not its
        // width — it is what the table's min-width is summed from.
        size: 360,
        meta: { skeleton: tableIconCellSkeleton({ lines: 2 }) },
        cell: ({ row }) => {
          const { accountEmail, label, plan, provider } = row.original;
          return (
            <TableIconCell
              // `outline` rather than a colour variant: it is the only
              // Badge surface built from theme tokens, so the plan chip
              // follows the page into dark mode (`slate` and its
              // siblings are fixed light tints — see the shared Badge).
              badges={
                plan ? <Badge variant="outline">{plan}</Badge> : undefined
              }
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
        // A dot and one short phrase. Sized for the English and German
        // labels on one line; the longest French one ("Réautorisation
        // nécessaire") wraps to two, which the row already has room for —
        // a wider column would be empty gutter on every other row.
        size: 150,
        // `icon-text`: the loaded cell is a dot plus one phrase, not a pill.
        meta: {
          className: 'overflow-hidden',
          skeleton: { type: 'icon-text', iconGap: 2 },
        },
        cell: ({ row }) => (
          <StatusIndicator variant={STATUS_VARIANT[row.original.status]}>
            {tStatus(row.original.status)}
          </StatusIndicator>
        ),
      },
      {
        id: 'usage',
        header: t('columns.usage'),
        // Two or three bar rows, each a 64px name + the bar + a 40px figure.
        size: 300,
        meta: { skeleton: { type: 'text', lines: 2 } },
        cell: ({ row }) => (
          <UsageCell windows={row.original.usage?.windows ?? []} />
        ),
      },
      {
        id: 'validUntil',
        accessorFn: (account) => account.expiresAt,
        header: () => (
          <span className="block w-full text-right">
            {t('columns.validUntil')}
          </span>
        ),
        // One short date, right-aligned against the row menu the way every
        // platform table ends on its timestamp.
        size: 140,
        meta: {
          align: 'right',
          headerLabel: t('columns.validUntil'),
          skeleton: { type: 'text', lines: 1 },
          className: 'overflow-hidden',
        },
        // The header says what the date means, so the cell is the date and
        // nothing else — a column of "Valid until 10/22/2026" repeats its own
        // heading on every row.
        cell: ({ row }) => (
          <Text truncate variant="caption">
            {row.original.expiresAt
              ? formatDate(row.original.expiresAt, 'short')
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
            // The default 10rem clips "Neu anmelden" / "Copier la commande
            // CLI"; `w-max` takes the longest label in whatever locale is on.
            contentWidth="w-max min-w-[12rem]"
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
    <>
      <SkipLink>{tPanel('skipToMain')}</SkipLink>
      <PanelHeader />
      {/* The strip is a sibling of the page column rather than
          `PageLayout header=` — that slot wraps its child in `StickyHeader`,
          whose own background and blur would sit on top of the ones the
          documentation header row already carries.

          `<main>` is the landmark the skip link lands on, and the reason
          every control on this screen sits inside one: a page whose only
          landmark is the header leaves a screen-reader user with no region
          to jump to. */}
      <main className="flex min-h-0 flex-1 flex-col" id="main" tabIndex={-1}>
        <PageLayout>
          <ContentArea variant="list">
            <DataTable
              addAction={{
                icon: Plus,
                label: t('add'),
                onClick: () => setDialog({ account: null }),
              }}
              approxRowCount={accounts.length || undefined}
              caption={t('caption')}
              columns={columns}
              data={rows}
              emptyState={{
                description: t('empty.description'),
                icon: KeyRound,
                title: t('empty.title'),
              }}
              error={loadError}
              // This screen IS the panel — nothing sits below the table — so
              // the frame keeps the whole height and the count footer stays on
              // the bottom edge whether the pool holds one account or fifty.
              fillHeight
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
        </PageLayout>
      </main>

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
    </>
  );
}

import { ContentArea } from '@tale/ui/content-area';
import { ACTIONS_COLUMN_SIZE } from '@tale/ui/data-table/column-builders';
import { DataTable } from '@tale/ui/data-table/data-table';
import {
  TableIconCell,
  tableIconCellSkeleton,
} from '@tale/ui/data-table/table-icon-cell';
import { DeleteDialog } from '@tale/ui/dialog/delete-dialog';
import { EntityRowActions } from '@tale/ui/entity/entity-row-actions';
import type { FilterConfig } from '@tale/ui/filters/filter-panel';
import { PageLayout } from '@tale/ui/page-layout';
import { SkipLink } from '@tale/ui/skip-link';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { useFormatDate } from '@tale/ui/use-format-date';
import { DEFAULT_LIST_PAGE_SIZE, useListPage } from '@tale/ui/use-list-page';
import { useToast } from '@tale/ui/use-toast';
import type { ColumnDef } from '@tanstack/react-table';
import { Copy, KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { gatewayApi, type AccountView, type ProviderId } from '@/app/lib/api';
import { useT } from '@/lib/i18n/client';

import { AddAccountDialog, type AddAccountTarget } from './add-account-dialog';
import { PanelHeader } from './panel-header';
import { PlanCell } from './plan-cell';
import { ProviderMark } from './provider-mark';
import { ResetsCell } from './resets-cell';
import { StatusCell } from './status-cell';
import { UsageCell } from './usage-cell';

/** The order the status filter offers, worst last. */
const STATUS_ORDER = ['active', 'expired', 'error'] as const;

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
  const { locale } = useFormatDate();
  const { toast } = useToast();

  const [providerFilter, setProviderFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
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
        // The widest share: a name, and a caption carrying the provider plus
        // an e-mail address. No column here is the flex one, so every `size`
        // is a proportion of the width the table gets — and together they
        // are the min-width it is summed from.
        size: 320,
        meta: { skeleton: tableIconCellSkeleton({ lines: 2 }) },
        cell: ({ row }) => {
          const { accountEmail, label, provider } = row.original;
          return (
            <TableIconCell
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
        id: 'plan',
        accessorFn: (account) => account.subscription?.plan ?? null,
        header: t('columns.plan'),
        // One chip — "Max 20x", "Pro Lite", "Enterprise" — and the longest of
        // those plus the chip's own padding is what this is sized for.
        size: 120,
        meta: { skeleton: { type: 'badge' } },
        cell: ({ row }) => (
          <PlanCell
            provider={row.original.provider}
            subscription={row.original.subscription}
          />
        ),
      },
      {
        id: 'status',
        accessorFn: (account) => account.status,
        header: t('columns.status'),
        // A glyph and one short phrase. Sized for the English and German
        // labels on one line; the longest French one ("Réautorisation
        // nécessaire") wraps to two, which the row already has room for —
        // a wider column would be empty gutter on every other row.
        size: 150,
        // `icon-text`: the loaded cell is a glyph plus one phrase, not a pill.
        meta: {
          className: 'overflow-hidden',
          skeleton: { type: 'icon-text', iconGap: 2 },
        },
        cell: ({ row }) => <StatusCell status={row.original.status} />,
      },
      {
        id: 'usage',
        header: t('columns.usage'),
        // Two or three bar rows, each a window's name, its bar and the figure
        // `ProgressBar` prints beside it.
        size: 240,
        meta: { skeleton: { type: 'text', lines: 2 } },
        cell: ({ row }) => (
          <UsageCell windows={row.original.usage?.windows ?? []} />
        ),
      },
      {
        id: 'resets',
        header: t('columns.resets'),
        // The same windows as its neighbour, on the same rows — the two cells
        // agree on which ones they draw and on their vertical rhythm, so the
        // clock for a window sits beside the spend for that window. Sized for
        // the widest distance any of the three languages prints ("quelques
        // secondes") next to a bar still worth looking at.
        size: 190,
        meta: { skeleton: { type: 'text', lines: 2 } },
        cell: ({ row }) => (
          <ResetsCell windows={row.original.usage?.windows ?? []} />
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
        // heading on every row. `TableDateCell` is the shared date cell every
        // platform list ends on: the short form in the row, the full one on
        // `title` for the reader who needs the hour.
        cell: ({ row }) => (
          <TableDateCell
            alignRight
            date={row.original.expiresAt}
            emptyText={t('noExpiry')}
            preset="short"
          />
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
    [copyCommand, t, tProviders],
  );

  // `DataTable` renders the `Error` it is handed, so the sentence a reader
  // sees has to be the translated one rather than whatever the API wrote.
  const loadError = useMemo(
    () => (error ? new Error(t('loadFailed')) : null),
    [error, t],
  );

  const filterConfigs = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'provider',
        title: t('filters.provider'),
        // The catalog's own order, so the facet lists vendors the way the
        // rows are grouped and the Add dialog offers them.
        options: providers.map((id) => ({ value: id, label: tProviders(id) })),
        selectedValues: providerFilter,
        onChange: setProviderFilter,
        multiSelect: true,
      },
      {
        key: 'status',
        title: t('filters.status'),
        options: STATUS_ORDER.map((status) => ({
          value: status,
          label: tStatus(status),
        })),
        selectedValues: statusFilter,
        onChange: setStatusFilter,
        multiSelect: true,
      },
    ],
    [providerFilter, providers, statusFilter, t, tProviders, tStatus],
  );

  const clearFilters = useCallback(() => {
    setProviderFilter([]);
    setStatusFilter([]);
  }, []);

  /**
   * The pool narrowed by the two facets, then ordered — the set the search
   * box and the count footer work on, the way Projects hands its list the
   * rows its team facet leaves.
   *
   * The order is the pool's own shape rather than an alphabet — vendors in
   * the catalog's order, and inside a vendor the accounts by address. An
   * operator opens this screen to answer "how is my Claude pool doing", which
   * a vendor's rows sitting together answers in one glance; sorting on the
   * address rather than the label keeps a renamed account where its e-mail
   * says it belongs. The comparison runs through `localeCompare` in the
   * reader's own locale, so an umlaut sorts where that reader expects it.
   */
  const rows = useMemo(() => {
    const matches = accounts.filter((account) => {
      if (
        providerFilter.length > 0 &&
        !providerFilter.includes(account.provider)
      ) {
        return false;
      }
      return statusFilter.length === 0 || statusFilter.includes(account.status);
    });

    const providerRank = (id: ProviderId) => {
      const index = providers.indexOf(id);
      // A provider the catalog no longer offers still has rows; park them
      // after the ones it does rather than at the top.
      return index === -1 ? providers.length : index;
    };

    return matches.toSorted((a, b) => {
      const byProvider = providerRank(a.provider) - providerRank(b.provider);
      if (byProvider !== 0) return byProvider;
      return (a.accountEmail ?? a.label).localeCompare(
        b.accountEmail ?? b.label,
        locale,
        { sensitivity: 'base' },
      );
    });
  }, [accounts, locale, providerFilter, providers, statusFilter]);

  /**
   * Search, the row window and the count footer — the list page's shared
   * state, so this table pages and counts exactly the way Projects and
   * Automations do: the rows scroll inside the frame, more load as the reader
   * nears the end, and the frame closes on "Showing all N accounts" (or
   * "N of M" while a search narrows it). The provider rides as a searched
   * value too, so "claude" or "chatgpt" finds a vendor's accounts by the name
   * the reader sees rather than by the id the row carries.
   */
  const list = useListPage<AccountView>({
    dataSource: { type: 'query', data: isLoading ? undefined : rows },
    pageSize: DEFAULT_LIST_PAGE_SIZE,
    search: {
      fields: [
        'label',
        'accountEmail',
        (account) => tProviders(account.provider),
      ],
      placeholder: t('searchPlaceholder'),
    },
    filters: { configs: filterConfigs, onClear: clearFilters },
    getRowId: (account) => account.id,
    approxRowCount: accounts.length || undefined,
    entityLabel: { one: t('entity.one'), other: t('entity.other') },
  });

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
              // The page inset comes from `ContentArea variant="list"`, which
              // also bounds the height this sticky frame fills — so the
              // toolbar and the header row stay put and only the rows scroll,
              // and a short pool gets a frame that hugs its rows.
              stickyLayout
              {...list.tableProps}
              addAction={{
                icon: Plus,
                label: t('add'),
                onClick: () => setDialog({ account: null }),
              }}
              caption={t('caption')}
              columns={columns}
              emptyState={{
                description: t('empty.description'),
                icon: KeyRound,
                title: t('empty.title'),
              }}
              error={loadError}
              onRetry={onReload}
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

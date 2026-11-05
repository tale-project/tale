import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { DataTable } from '@tale/ui/data-table/data-table';
import { DataTableActionMenu } from '@tale/ui/data-table/data-table-action-menu';
import {
  DataTableFilters,
  DataTableToolbar,
} from '@tale/ui/data-table/data-table-filters';
import { DEFAULT_LIST_PAGE_SIZE } from '@tale/ui/list-page-size';
import { useListPage } from '@tale/ui/use-list-page';
import { KeyRound, Plus, SearchX, X } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { useFitsWidth, useWidthValue } from '@/app/hooks/use-fits-width';
import { useMeta } from '@/app/hooks/use-meta';
import { useSearchInAddress } from '@/app/hooks/use-search-in-address';
import { readFailureText } from '@/app/lib/api/failure';
import type { SecretKind, SecretSummary } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useSecretLabels } from '../hooks/use-secret-labels';
import { useSecrets } from '../hooks/use-secrets';
import {
  SECRETS_TABLE_MIN_WIDTH,
  scopeGrowth,
  useSecretsColumns,
} from '../hooks/use-secrets-columns';
import { useSecretsFilters } from '../hooks/use-secrets-filters';
import { matchesFilters, type SecretsFilters } from '../lib/filters';
import { DEFAULT_KIND } from '../lib/kinds';
import { SCOPE_ALL, SCOPE_GLOBAL } from '../lib/scope';
import { SecretDeleteDialog } from './secret-delete-dialog';
import { SecretFormDialog } from './secret-form-dialog';
import type { ReturnPoint } from './secret-row-actions';
import { SecretViewDialog } from './secret-view-dialog';
import { SecretsFilterChips } from './secrets-filter-chips';

type DialogState =
  | { type: 'create'; kind: SecretKind; scope: string }
  | {
      type: 'view' | 'edit' | 'delete';
      secret: SecretSummary;
      /** The control of the row that asked, where the focus goes back to. */
      returnTo?: ReturnPoint;
    }
  | null;

const getRowId = (secret: SecretSummary) => String(secret.id);

interface SecretsTableProps {
  /** What narrows the list: the page keeps it in its address, so a reload keeps the view. */
  filters: SecretsFilters;
  onFiltersChange: (filters: SecretsFilters) => void;
  /** What the search box holds, as the address of the page says it ("" for nothing). */
  query: string;
  onQueryChange: (query: string) => void;
}

const NO_SEARCH = () => {};

/**
 * The secrets collection: one list of all of them, narrowed by type, by who
 * they are available to and by a search over what the row shows. The type and
 * the session are Tale's Filter button; the search is the table's own. Opening
 * a row reads it; the menu changes or deletes it; Add opens the form. Dialogs
 * mount while open, so each starts from what the person last saw.
 */
export function SecretsTable({
  filters,
  onFiltersChange,
  query,
  onQueryChange,
}: SecretsTableProps) {
  const { t } = useT('secrets');
  const { t: tCommon } = useT('common');
  const { t: tErrors } = useT('errors');
  const labels = useSecretLabels();
  const read = useSecrets();
  const meta = useMeta();
  const rows = read.data;

  const [dialog, setDialog] = useState<DialogState>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const region = useRef<HTMLDivElement>(null);
  // The column decides, not the window: with the columns it needs it is a
  // table, and with less than that (a phone, a narrow window, a page zoomed in)
  // it is one row per secret, which has no part to scroll to.
  const compact = !useFitsWidth(region, SECRETS_TABLE_MIN_WIDTH);
  // A wide column has room to spare: who a secret is for gets part of it, as a
  // normal name needs, and the details keep the rest.
  const growth = useWidthValue(region, scopeGrowth, 0);

  const narrowed = useMemo(
    () => rows?.filter((secret) => matchesFilters(secret, filters)),
    [rows, filters],
  );
  const { configs, chips, clear } = useSecretsFilters({
    rows,
    filters,
    onFiltersChange,
  });

  const openView = useCallback(
    (secret: SecretSummary, returnTo?: ReturnPoint) =>
      setDialog({ type: 'view', secret, returnTo }),
    [],
  );
  const openEdit = useCallback(
    (secret: SecretSummary, returnTo?: ReturnPoint) =>
      setDialog({ type: 'edit', secret, returnTo }),
    [],
  );
  const openDelete = useCallback(
    (secret: SecretSummary, returnTo?: ReturnPoint) =>
      setDialog({ type: 'delete', secret, returnTo }),
    [],
  );
  const close = useCallback((open: boolean) => {
    if (!open) setDialog(null);
  }, []);

  const columns = useSecretsColumns({
    compact,
    scopeGrowth: growth,
    onView: openView,
    onEdit: openEdit,
    onDelete: openDelete,
  });

  // A new secret starts as the kind and for the session the list is narrowed to.
  const openCreate = () =>
    setDialog({
      type: 'create',
      kind: filters.kind === 'all' ? DEFAULT_KIND : filters.kind,
      scope: filters.scope === SCOPE_ALL ? SCOPE_GLOBAL : filters.scope,
    });

  const list = useListPage<SecretSummary>({
    dataSource: {
      type: 'query',
      data: narrowed,
      // A failed first read is named in place of the table (`unread`); a
      // failed refresh of rows already on screen, above it.
      error: rows === undefined ? read.error : null,
      retry: () => void read.refetch(),
    },
    pageSize: DEFAULT_LIST_PAGE_SIZE,
    windowKey: `${filters.kind}:${filters.scope}`,
    filters: { configs, onClear: clear },
    search: {
      // What a row shows, so a search finds what is read in it.
      fields: [
        'title',
        'preview',
        (secret) => labels.kind(secret.kind),
        (secret) => secret.session?.name,
      ],
      placeholder: t('table.searchPlaceholder'),
    },
    getRowId,
    // As many masked rows as there are secrets, or the empty state at once.
    approxRowCount: meta.data?.counts.secrets,
    entityLabel: { one: t('table.entityOne'), other: t('table.entityOther') },
  });

  // The search box is kept in the address with the filters.
  const searchBox = list.tableProps.search;
  useSearchInAddress({
    text: searchBox?.value ?? '',
    setText: searchBox?.onChange ?? NO_SEARCH,
    addressText: query,
    setAddressText: onQueryChange,
  });

  // Something narrows the list: a type, a session or a search.
  const narrowing = chips.length > 0 || (searchBox?.value ?? '') !== '';

  // With no secret at all there is nothing to search or narrow: there is no
  // toolbar, and the Add button is in the empty state, where it is the one
  // thing to do. Nor is there a toolbar over a list that could not be read.
  // While the list is on its way the counts decide, which the root route has
  // in before the first frame: no secret is the empty state from the start,
  // not a toolbar and masked rows that vanish when the list comes.
  const unread = rows === undefined && read.isError;
  const collectionEmpty =
    rows === undefined
      ? !unread && meta.data?.counts.secrets === 0
      : rows.length === 0;
  // The page's banner says why the server could not be asked, and the sentence
  // adds a cause only when trying again does not mend it. Over rows that stay
  // it names what the failure means for them; a list that never loaded has it
  // in place of the table, in the words of this page (as the sessions have
  // it), not the library's generic error with a link to its own support page.
  const failure = (
    <CatalogLoadError
      message={readFailureText(
        // A list that never loaded has no rows that "may be out of date".
        t(unread ? 'listFailed' : 'refreshFailed'),
        read.error,
        tErrors,
      )}
      onRetry={() => void read.refetch()}
      isRetrying={read.isFetching}
      failureKey={read.errorUpdatedAt}
      onFocusLost={() => region.current?.focus()}
    />
  );

  // The table is told neither the search nor the filters: their controls are
  // the toolbar's below, so the chips can have a row of their own under it.
  // What it is told is what to say when it has no row to show.
  const hiddenByFilters =
    rows !== undefined && rows.length > 0 && narrowed?.length === 0;
  const emptyState =
    collectionEmpty || rows === undefined
      ? {
          icon: KeyRound,
          title: t('empty.title'),
          description: t('empty.description'),
          headingLevel: 2 as const,
        }
      : {
          icon: SearchX,
          // A search or a filter that finds nothing is not an empty list: the
          // shared words, and the way out of it.
          title: tCommon('search.noResults'),
          description: tCommon('search.tryAdjusting'),
          headingLevel: 2 as const,
          action: hiddenByFilters ? (
            <Button type="button" variant="secondary" onClick={clear}>
              {t('noMatches.showAll')}
            </Button>
          ) : undefined,
        };

  return (
    <div
      ref={region}
      role="region"
      aria-label={t('table.caption')}
      tabIndex={-1}
      className="short-viewport:flex-none flex min-h-0 flex-1 flex-col gap-6 outline-none"
    >
      {read.isError && rows !== undefined ? failure : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {collectionEmpty || unread ? null : (
          <div className="flex shrink-0 flex-col gap-3 pb-4">
            <DataTableToolbar
              action={
                <DataTableActionMenu
                  triggerRef={addButton}
                  label={t('actions.add')}
                  icon={Plus}
                  disabled={meta.data === undefined}
                  onClick={openCreate}
                />
              }
            >
              <DataTableFilters
                search={list.tableProps.search}
                filters={list.tableProps.filters}
              >
                {/* The library's own "Clear all" of this toolbar
                    (`data-table-filters.tsx`) is the German "Alle löschen",
                    which reads as deleting every secret: this one says what it
                    lifts, in words of its own. It lifts the same things. */}
                {narrowing && list.tableProps.onClearFilters ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={list.tableProps.onClearFilters}
                    className="hidden gap-2 sm:flex"
                  >
                    <X className="size-4" />
                    {t('filters.clearAll')}
                  </Button>
                ) : null}
              </DataTableFilters>
            </DataTableToolbar>
            <SecretsFilterChips chips={chips} />
          </div>
        )}
        {unread ? (
          failure
        ) : (
          <DataTable
            stickyLayout
            {...list.tableProps}
            search={undefined}
            filters={undefined}
            onClearFilters={undefined}
            columns={columns}
            caption={t('table.caption')}
            onRowClick={(row) => openView(row.original)}
            addAction={
              collectionEmpty
                ? {
                    triggerRef: addButton,
                    label: t('actions.add'),
                    icon: Plus,
                    disabled: meta.data === undefined,
                    onClick: openCreate,
                  }
                : undefined
            }
            emptyState={emptyState}
          />
        )}
      </div>
      {dialog?.type === 'create' ? (
        <SecretFormDialog
          target={{ type: 'create', kind: dialog.kind, scope: dialog.scope }}
          onOpenChange={close}
          restoreFocusRef={addButton}
        />
      ) : null}
      {dialog?.type === 'edit' ? (
        <SecretFormDialog
          target={{ type: 'edit', secret: dialog.secret }}
          onOpenChange={close}
          restoreFocusRef={dialog.returnTo}
        />
      ) : null}
      {dialog?.type === 'view' ? (
        <SecretViewDialog
          secret={dialog.secret}
          onOpenChange={close}
          restoreFocusRef={dialog.returnTo}
        />
      ) : null}
      {dialog?.type === 'delete' ? (
        <SecretDeleteDialog
          secret={dialog.secret}
          onOpenChange={close}
          restoreFocusRef={dialog.returnTo}
        />
      ) : null}
    </div>
  );
}

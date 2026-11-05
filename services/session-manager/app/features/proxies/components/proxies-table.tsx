import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { DataTable } from '@tale/ui/data-table/data-table';
import { DataTableActionMenu } from '@tale/ui/data-table/data-table-action-menu';
import { Text } from '@tale/ui/text';
import { DEFAULT_LIST_PAGE_SIZE, useListPage } from '@tale/ui/use-list-page';
import { FileUp, Network, Plus, X } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { useFitsWidth } from '@/app/hooks/use-fits-width';
import { useMeta } from '@/app/hooks/use-meta';
import { useSearchInAddress } from '@/app/hooks/use-search-in-address';
import { readFailureText } from '@/app/lib/api/failure';
import type { Proxy } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import {
  PROXIES_TABLE_MIN_WIDTH,
  useProxiesColumns,
} from '../hooks/use-proxies-columns';
import { useProxyList } from '../hooks/use-proxy-list';
import { useProxySearchFields } from '../hooks/use-proxy-search-fields';
import { AddProxyDialog } from './add-proxy-dialog';
import { CheckAllButton } from './check-all-button';
import { ImportProxiesDialog } from './import-proxies-dialog';

const getRowId = (proxy: Proxy) => String(proxy.id);

type Dialog = 'add' | 'import';

interface ProxiesTableProps {
  /**
   * What the search box holds, as the address of the page says it ("" for
   * nothing). Without these the table has no address to keep its search in.
   */
  query?: string;
  onQueryChange?: (query: string) => void;
}

const NO_SEARCH = () => {};

/**
 * The pool of proxies as a collection screen: search over what is loaded, the
 * newest first, more as the reader nears the end, and in the toolbar the ways
 * to check every proxy and to add proxies one by one or by the list.
 */
export function ProxiesTable({ query = '', onQueryChange }: ProxiesTableProps) {
  const { t } = useT('proxies');
  const { t: tErrors } = useT('errors');
  const pool = useProxyList();
  const meta = useMeta();
  const searchFields = useProxySearchFields();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // The Add button of the table, in the toolbar or in the empty state: where
  // the focus returns to after a dialog, whichever of the two it is in by then.
  const addTrigger = useRef<HTMLButtonElement>(null);
  // Named and focusable, so a focus that lost its control has somewhere to go.
  const region = useRef<HTMLElement>(null);

  // The column decides, not the window: with the columns it needs it is a
  // table, and with less than that (a phone, a narrow window, a page zoomed in)
  // it is one row per proxy, which has no part to scroll to.
  const compact = !useFitsWidth(region, PROXIES_TABLE_MIN_WIDTH);
  const columns = useProxiesColumns({ compact });

  const { refetch } = pool;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  const dataSource = useMemo(
    () => ({
      type: 'paginated' as const,
      results: pool.isPending ? undefined : pool.proxies,
      status: pool.status,
      loadMore: pool.loadMore,
      isLoading: pool.isPending,
      error: pool.isError ? pool.error : null,
      retry,
    }),
    [
      pool.isPending,
      pool.proxies,
      pool.status,
      pool.loadMore,
      pool.isError,
      pool.error,
      retry,
    ],
  );

  const entityLabel = useMemo(
    () => ({ one: t('entity.one'), other: t('entity.other') }),
    [t],
  );

  const list = useListPage<Proxy>({
    dataSource,
    pageSize: DEFAULT_LIST_PAGE_SIZE,
    search: { fields: searchFields, placeholder: t('search.placeholder') },
    getRowId,
    approxRowCount: meta.data?.counts.proxies,
    entityLabel,
  });

  const findProxy = useCallback(
    (id: number) => pool.proxies.find((proxy) => proxy.id === id),
    [pool.proxies],
  );
  const searchFor = list.tableProps.search?.onChange;
  // The search box is kept in the address of the page, where there is one.
  useSearchInAddress({
    text: list.tableProps.search?.value ?? '',
    setText: searchFor ?? NO_SEARCH,
    addressText: query,
    setAddressText: onQueryChange ?? NO_SEARCH,
    enabled: onQueryChange !== undefined,
  });
  const showInList = useCallback(
    (text: string) => {
      searchFor?.(text);
      setDialog(null);
    },
    [searchFor],
  );
  // What was just added is new, the newest first: a search that would hide it
  // is put away, so it is the first thing the person sees.
  const showEverything = useCallback(() => searchFor?.(''), [searchFor]);
  const closeDialog = useCallback((open: boolean) => {
    if (!open) setDialog(null);
  }, []);
  // Where the focus goes when the control that held it (the retry of a load
  // failure) is taken away by a refresh that worked.
  const focusRegion = useCallback(() => region.current?.focus(), []);

  // Read, and with nothing in it; while the first rows are on their way, the
  // counts decide, which the root route has in before the first frame: a pool
  // with proxies has the toolbar already, one without has its empty state from
  // the start, not a toolbar and masked rows that vanish when the rows come.
  // One that could not be read has the failure instead.
  const collectionEmpty = pool.isPending
    ? meta.data?.counts.proxies === 0
    : !pool.isError && pool.proxies.length === 0;
  // A pool that could not be read and has nothing to show: the failure takes
  // the table's place, in the words of this page (as the sessions have it), not
  // the library's generic error with a link to its own support page.
  const unread = pool.isError && pool.proxies.length === 0;

  const searching = (list.tableProps.search?.value ?? '') !== '';
  const clearSearch = list.tableProps.onClearFilters;

  const counts = meta.data?.counts;
  const summary =
    counts === undefined || counts.proxies === 0
      ? null
      : t('summary.line', {
          total: counts.proxies,
          free: counts.freeProxies,
          failed: counts.failedProxies,
        });

  // The button names what it adds and its menu the two ways to add: by hand,
  // or from a list.
  const addMenu = useMemo(
    () => ({
      label: t('actions.add'),
      icon: Plus,
      triggerRef: addTrigger,
      menuItems: [
        {
          label: t('actions.addProxy'),
          icon: Plus,
          onClick: () => setDialog('add'),
        },
        {
          label: t('actions.importProxies'),
          icon: FileUp,
          onClick: () => setDialog('import'),
        },
      ],
    }),
    [t],
  );

  // The page's banner says why the server could not be asked, and the sentence
  // adds a cause only when trying again does not mend it.
  const failure = pool.isError ? (
    <CatalogLoadError
      message={readFailureText(
        // A list that never loaded has no rows that "may be out of date".
        t(unread ? 'listFailed' : 'refreshFailed'),
        pool.error,
        tErrors,
      )}
      onRetry={retry}
      isRetrying={pool.isFetching}
      failureKey={pool.failedAt}
      onFocusLost={focusRegion}
    />
  ) : null;

  return (
    <>
      {/* The rows stay through a failed refresh; the failure is named above
          them, as what it means for the list, with the retry. A list that
          never loaded has it in place of the table. */}
      {unread ? null : failure}
      <section
        ref={region}
        aria-label={t('table.region')}
        tabIndex={-1}
        className="flex min-h-0 min-w-0 flex-1 flex-col outline-none"
      >
        {unread ? (
          failure
        ) : (
          <DataTable
            stickyLayout
            caption={t('table.caption')}
            columns={columns}
            // The create action is the table's own, as the platform's contacts
            // table has it: in the empty state while there are no proxies, and
            // in the toolbar, with the check of every proxy beside it, once there
            // are some (the toolbar's cluster is `actionMenu`, as the platform's
            // `contacts-action-menu.tsx` and `tasks-workspace.tsx` compose theirs).
            addAction={addMenu}
            actionMenu={
              collectionEmpty ? undefined : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <CheckAllButton />
                  <DataTableActionMenu {...addMenu} />
                </div>
              )
            }
            emptyState={{
              icon: Network,
              title: t('empty.title'),
              description: t('empty.description'),
              headingLevel: 2,
            }}
            filtersContent={
              collectionEmpty ? undefined : (
                <>
                  {summary === null ? null : (
                    <Text as="p" variant="muted">
                      {summary}
                    </Text>
                  )}
                  {/* The library's own "Clear all" of this toolbar
                    (`data-table-filters.tsx`) is the German "Alle löschen", which
                    next to a list of proxies reads as deleting them all: this one
                    says what it lifts. */}
                  {searching && clearSearch ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={clearSearch}
                      className="hidden gap-2 sm:flex"
                    >
                      <X className="size-4" />
                      {t('search.clear')}
                    </Button>
                  ) : null}
                </>
              )
            }
            {...list.tableProps}
            // With no proxy there is nothing to search or count: the table has
            // no toolbar, and the empty state is the one place to add them.
            search={collectionEmpty ? undefined : list.tableProps.search}
            // The toolbar's button that lifts the search is ours (above).
            onClearFilters={undefined}
            // The count of the pool, not of what is loaded of it: the loaded
            // window is always ahead of the rows shown, and "of 60" would
            // name the window as the pool.
            infiniteScroll={{
              ...list.tableProps.infiniteScroll,
              totalCount: pool.total,
            }}
          />
        )}
      </section>
      <AddProxyDialog
        open={dialog === 'add'}
        onOpenChange={closeDialog}
        findProxy={findProxy}
        onShow={showInList}
        onAdded={showEverything}
        restoreFocusRef={addTrigger}
      />
      <ImportProxiesDialog
        open={dialog === 'import'}
        onOpenChange={closeDialog}
        onShow={showInList}
        onAdded={showEverything}
        restoreFocusRef={addTrigger}
      />
    </>
  );
}

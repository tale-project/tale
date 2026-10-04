import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
  type ShippedLocale,
} from '@/tests/utils/lapsed-session';
import {
  act,
  configure,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { TrashPage } from './trash-page';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #3641: a Trash read that failed said "Trash is empty" and disabled the
// filter — the same page an organization with nothing to recover gets. The
// whole read lane runs for real here — `useListTrashedRows`,
// `useBackendQuery`, the adapter row, `backendFetch` and the read retry
// policy (four attempts for a fault) — against a closed synthetic
// transport, so the same mounted page can be watched failing and
// recovering.

vi.mock('@/app/hooks/use-session-user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-session-user')>()),
  useSessionUser: () => ({ isAuthenticated: true, isLoading: false }),
}));
// The page is admin-only; the reader here is an admin.
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
  useAbilityLoading: () => false,
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const FIRST_PAGE = /^GET \/api\/app\/governance\/trash\?limit=20&orgId=org-1$/;
const NEXT_PAGE = /^GET \/api\/app\/governance\/trash\?cursor=/;
const ANY_PAGE = /^GET \/api\/app\/governance\/trash\?/;

const TRASHED_AT = 1_789_450_000_000;

/** 25 synthetic trashed documents, newest first, as the door pages them
 * (20 + 5). */
const RECORDS = Array.from({ length: 25 }, (_, index) => {
  const n = String(25 - index).padStart(2, '0');
  return {
    resourceType: 'document',
    id: `record-${n}`,
    status: 'trashed',
    statusChangedAt: TRASHED_AT - index,
    createdAt: TRASHED_AT - index,
    displayName: `Synthetic record ${n}`,
    ownerId: 'user-1',
    ownerName: 'Ada Lovelace',
  };
});

function base64Url(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

/** The door's pages: the first 20 records, then the rest after the cursor
 * the first page handed out. */
function pagedRecords(url: URL) {
  const cursor = url.searchParams.get('cursor');
  if (cursor === null) {
    const last = RECORDS[19];
    return Response.json({
      rows: RECORDS.slice(0, 20),
      nextCursor: base64Url({
        resourceType: last?.resourceType,
        statusChangedAt: last?.statusChangedAt,
        id: last?.id,
      }),
    });
  }
  return Response.json({ rows: RECORDS.slice(20), nextCursor: null });
}

/** The table's scroll sentinel, under the test's control: jsdom lays
 * nothing out, so "scrolled to the end" is said here. */
const sentinels = new Set<IntersectionObserverCallback>();
class ControlledIntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  private readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe() {
    sentinels.add(this.callback);
  }
  unobserve() {
    sentinels.delete(this.callback);
  }
  disconnect() {
    sentinels.delete(this.callback);
  }
  takeRecords() {
    return [];
  }
}

function scrollToEnd() {
  act(() => {
    for (const callback of sentinels) {
      callback(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the sentinel reads `isIntersecting` alone
        [{ isIntersecting: true } as IntersectionObserverEntry],
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- unused by the sentinel
        {} as IntersectionObserver,
      );
    }
  });
}

/** The alert standing in for a first page that never answered, and its
 * Try again, as each shipped locale words them — pinned here so a missing
 * translation fails. */
const LOAD_FAILED: Record<ShippedLocale, string> = {
  en: "Couldn't load the records in Trash.",
  de: 'Die Datensätze im Papierkorb konnten nicht geladen werden.',
  fr: 'Impossible de charger les enregistrements de la corbeille.',
};
const TRY_AGAIN: Record<ShippedLocale, string> = {
  en: 'Try again',
  de: 'Erneut versuchen',
  fr: 'Réessayer',
};

/** The notice over rows a later read failed to complete, as each shipped
 * locale words it — pinned here so a missing translation fails. */
const REFRESH_FAILED: Record<ShippedLocale, string> = {
  en: "Couldn't load the latest records. What's listed may be incomplete or out of date.",
  de: 'Die neuesten Datensätze konnten nicht geladen werden. Die Liste ist womöglich unvollständig oder veraltet.',
  fr: 'Impossible de charger les derniers enregistrements. La liste est peut-être incomplète ou obsolète.',
};

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState(
    {},
    '',
    '/dashboard/org-1/settings/governance/trash',
  );
  vi.stubGlobal('IntersectionObserver', ControlledIntersectionObserver);
  backend = syntheticBackend();
  // No backoff between the policy's attempts; the attempt count is real.
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  sentinels.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function renderTrash() {
  return render(
    <QueryClientProvider client={client}>
      <TrashPage organizationId="org-1" />
    </QueryClientProvider>,
  );
}

const t = (key: string) => i18n.t(key, { ns: 'governance' });
const emptyTitle = () => t('trash.emptyTitle');
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const filterButton = () =>
  screen.getByRole('button', {
    name: i18n.t('labels.filter', { ns: 'common' }),
  });
const trashRegion = () =>
  screen.getByRole('region', { name: t('trash.title') });

/** Answer the next request to `pattern` only when the test says so, with a
 * 503 — so the state while a retry runs can be read. */
function holdNext(pattern: RegExp): () => void {
  let release: () => void = () => undefined;
  backend.on(
    pattern,
    () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(serviceUnavailable());
      }),
  );
  return () => release();
}

describe('TrashPage when its read fails', { timeout: 30_000 }, () => {
  it('announces a failed first page as an alert with Try again, never as an empty trash, and recovers in place', async () => {
    backend.on(ANY_PAGE, () => serviceUnavailable());
    const { user } = renderTrash();

    const alert = await screen.findByRole('alert');
    // The policy's four attempts, then the failure — said in the page's
    // own words, in a live region a screen reader announces.
    expect(backend.count(FIRST_PAGE)).toBe(4);
    expect(alert).toHaveTextContent(t('trash.loadFailed'));
    // Nothing about the trash is known: no empty state, and no table whose
    // disabled filter would say there is nothing to narrow.
    expect(screen.queryByText(emptyTitle())).not.toBeInTheDocument();
    expect(screen.queryByText(t('trash.empty'))).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    // The same mounted page recovers on Try again, with no reload.
    backend.on(ANY_PAGE, pagedRecords);
    await user.click(within(alert).getByRole('button', { name: tryAgain() }));
    expect(await screen.findByText('Synthetic record 25')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(emptyTitle())).not.toBeInTheDocument();
    expect(filterButton()).toBeEnabled();
    expect(backend.count(FIRST_PAGE)).toBe(5);
    // Try again went with the alert; its focus is on the Trash section,
    // not on the page.
    await waitFor(() => expect(trashRegion()).toHaveFocus());
  });

  it('keeps Try again focused and busy through a retry that fails again, and announces the new failure', async () => {
    backend.on(ANY_PAGE, () => serviceUnavailable());
    const { user } = renderTrash();
    const alert = await screen.findByRole('alert');
    const retry = within(alert).getByRole('button', { name: tryAgain() });
    const failure = within(alert).getByText(t('trash.loadFailed'));

    // From the keyboard, with the retry's first attempt held open.
    const release = holdNext(ANY_PAGE);
    retry.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
    // While it runs the failure stays named — no skeleton, no empty state,
    // no table — and nothing new is announced: the alert, its sentence and
    // Try again are the same nodes, and Try again keeps the focus.
    expect(screen.getByRole('alert')).toBe(alert);
    expect(within(alert).getByText(t('trash.loadFailed'))).toBe(failure);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(emptyTitle())).not.toBeInTheDocument();
    expect(retry).toHaveFocus();

    // It fails again: the sentence is put back as a new node, which the
    // live region announces afresh; Try again keeps its node and focus.
    backend.on(ANY_PAGE, () => serviceUnavailable());
    release();
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
    expect(backend.count(FIRST_PAGE)).toBe(8);
    expect(screen.getByRole('alert')).toBe(alert);
    const announced = within(alert).getByText(t('trash.loadFailed'));
    expect(announced).not.toBe(failure);
    expect(within(alert).getByRole('button', { name: tryAgain() })).toBe(retry);
    expect(retry).toHaveFocus();

    // It answers: the alert goes and hands its focus to the section.
    backend.on(ANY_PAGE, pagedRecords);
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Synthetic record 25')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(trashRegion()).toHaveFocus());
  });

  it('keeps the chosen category through a failed first page and retries that same read', async () => {
    const DOCUMENTS =
      /^GET \/api\/app\/governance\/trash\?resourceTypes=document&limit=20&orgId=org-1$/;
    backend.on(ANY_PAGE, pagedRecords);
    const { user } = renderTrash();
    await screen.findByText('Synthetic record 25');

    // Narrowing to Documents asks for a first page of its own, which fails.
    backend.on(DOCUMENTS, () => serviceUnavailable());
    await user.click(filterButton());
    if (screen.queryAllByRole('checkbox').length === 0) {
      await user.click(screen.getByRole('button', { name: /Category/ }));
    }
    await user.click(screen.getByRole('checkbox', { name: 'Documents' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('trash.loadFailed'));
    expect(backend.count(DOCUMENTS)).toBe(4);
    expect(screen.queryByText('Synthetic record 25')).not.toBeInTheDocument();

    // Try again asks for the Documents page again — the category was kept —
    // and the list comes back narrowed, its Filter usable.
    backend.on(DOCUMENTS, () =>
      Response.json({ rows: RECORDS.slice(5, 7), nextCursor: null }),
    );
    const unfiltered = backend.count(FIRST_PAGE);
    await user.click(within(alert).getByRole('button', { name: tryAgain() }));
    expect(await screen.findByText('Synthetic record 20')).toBeInTheDocument();
    expect(screen.queryByText('Synthetic record 25')).not.toBeInTheDocument();
    expect(backend.count(DOCUMENTS)).toBe(5);
    expect(backend.count(FIRST_PAGE)).toBe(unfiltered);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(filterButton());
    if (screen.queryAllByRole('checkbox').length === 0) {
      await user.click(screen.getByRole('button', { name: /Category/ }));
    }
    expect(screen.getByRole('checkbox', { name: 'Documents' })).toBeChecked();
  });

  it('keeps the empty state for a trash that is really empty', async () => {
    backend.on(ANY_PAGE, () => Response.json({ rows: [], nextCursor: null }));
    renderTrash();

    expect(await screen.findByText(emptyTitle())).toBeInTheDocument();
    expect(filterButton()).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: tryAgain() }),
    ).not.toBeInTheDocument();
  });

  it('names a failed refresh over an empty trash without taking back what it last said', async () => {
    backend.on(ANY_PAGE, () => Response.json({ rows: [], nextCursor: null }));
    const { user } = renderTrash();
    await screen.findByText(emptyTitle());

    // A background refresh (the tab regaining focus) fails.
    backend.on(ANY_PAGE, () => serviceUnavailable());
    void client.invalidateQueries();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('trash.refreshFailed'));
    expect(screen.getByText(emptyTitle())).toBeInTheDocument();

    backend.on(ANY_PAGE, pagedRecords);
    await user.click(within(alert).getByRole('button', { name: tryAgain() }));
    expect(await screen.findByText('Synthetic record 25')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the loaded rows when the next page fails, never claims they are all, and loads the rest on Try again', async () => {
    backend.on(ANY_PAGE, pagedRecords);
    backend.on(NEXT_PAGE, () => serviceUnavailable());
    const { user } = renderTrash();
    await screen.findByText('Synthetic record 25');

    scrollToEnd();
    const alert = await screen.findByRole('alert');
    expect(backend.count(NEXT_PAGE)).toBe(4);
    expect(alert).toHaveTextContent(t('trash.refreshFailed'));
    expect(screen.getByText('Synthetic record 06')).toBeInTheDocument();
    expect(
      screen.getByText(
        i18n.t('pagination.showingLoadedFailed', {
          ns: 'common',
          count: 20,
          entityOne: t('trash.entityLabelOne'),
          entityOther: t('trash.entityLabel'),
        }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        i18n.t('pagination.showingAll', {
          ns: 'common',
          count: 20,
          entityOne: t('trash.entityLabelOne'),
          entityOther: t('trash.entityLabel'),
        }),
      ),
    ).not.toBeInTheDocument();
    // Scrolling asks for nothing more until the reader retries.
    scrollToEnd();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(backend.count(NEXT_PAGE)).toBe(4);

    backend.on(NEXT_PAGE, pagedRecords);
    await user.click(within(alert).getByRole('button', { name: tryAgain() }));
    expect(await screen.findByText('Synthetic record 01')).toBeInTheDocument();
    expect(screen.getByText('Synthetic record 25')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // The retry asked for the failed page once, not the list again.
    expect(backend.count(NEXT_PAGE)).toBe(5);
    expect(backend.count(FIRST_PAGE)).toBe(1);
    expect(
      screen.getByText(
        i18n.t('pagination.showingAll', {
          ns: 'common',
          count: 25,
          entityOne: t('trash.entityLabelOne'),
          entityOther: t('trash.entityLabel'),
        }),
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(trashRegion()).toHaveFocus());
  });

  it('keeps the rows through a failed refresh and says they may be out of date', async () => {
    backend.on(ANY_PAGE, () =>
      Response.json({ rows: RECORDS.slice(0, 3), nextCursor: null }),
    );
    const { user } = renderTrash();
    await screen.findByText('Synthetic record 25');

    // A background refresh (the tab regaining focus) fails.
    backend.on(ANY_PAGE, () => serviceUnavailable());
    void client.invalidateQueries();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('trash.refreshFailed'));
    expect(screen.getByText('Synthetic record 25')).toBeInTheDocument();

    backend.on(ANY_PAGE, () =>
      Response.json({ rows: RECORDS.slice(1, 3), nextCursor: null }),
    );
    await user.click(within(alert).getByRole('button', { name: tryAgain() }));
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('Synthetic record 25')).not.toBeInTheDocument();
    expect(screen.getByText('Synthetic record 24')).toBeInTheDocument();
  });

  it.each(SHIPPED_LOCALES)(
    'names a failed first page and its Try again in the reader’s language (%s)',
    async (locale) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      backend.on(ANY_PAGE, () => serviceUnavailable());
      renderTrash();

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(LOAD_FAILED[locale]);
      expect(
        within(alert).getByRole('button', { name: TRY_AGAIN[locale] }),
      ).toBeInTheDocument();
    },
  );

  it.each(SHIPPED_LOCALES)(
    'names a failed later read in the reader’s language (%s)',
    async (locale) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      backend.on(ANY_PAGE, pagedRecords);
      backend.on(NEXT_PAGE, () => serviceUnavailable());
      renderTrash();
      await screen.findByText('Synthetic record 25');

      scrollToEnd();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        REFRESH_FAILED[locale],
      );
    },
  );

  it('passes axe audit in its failed state', async () => {
    backend.on(ANY_PAGE, () => serviceUnavailable());
    const { container } = renderTrash();
    await screen.findByRole('alert');
    await checkAccessibility(container);
  });
});

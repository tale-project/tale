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

import { ProjectSecretsTab } from './project-secrets-tab';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #3887: a secrets read that failed for any reason but an access refusal
// mounted the editor over an empty list — the page a project with no secrets
// gets — so an administrator could add, and so overwrite, a stored secret the
// page could not show. The whole read lane runs for real here —
// `useProjectSecrets`, `useBackendQuery`, the adapter row, `backendFetch` and
// the read retry policy (four attempts for a fault) — against a closed
// synthetic transport, so the same mounted tab can be watched failing and
// recovering. Every name is a synthetic placeholder; the door never returns
// a secret's value, and no test sends one.

// The tab reads its project only for the archived gate; this one is active.
vi.mock('../hooks/queries', () => ({
  useProject: () => ({ project: {}, isLoading: false }),
}));
// The remove confirmation's error boundary reads the org id from the router.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const SECRETS = /^GET \/api\/app\/projects\/proj-1\/secrets\?orgId=org-1$/;
/** Any write at all — a set, a delete, anything but a read. */
const WRITES = /^(POST|PUT|PATCH|DELETE) /;

/** The door's list of stored secrets: names only, never a value. */
function storedSecrets(...names: string[]) {
  return () =>
    Response.json({
      secrets: names.map((name) => ({
        name,
        description: null,
        updatedAt: 1_789_450_000_000,
        updatedBy: 'user-1',
      })),
    });
}

/** The alert standing in for a read that never answered, and its Try
 * again, as each shipped locale words them — pinned here so a missing
 * translation fails. */
const LOAD_FAILED: Record<ShippedLocale, string> = {
  en: "Couldn't load this project's secrets.",
  de: 'Die Secrets dieses Projekts konnten nicht geladen werden.',
  fr: 'Impossible de charger les secrets de ce projet.',
};
const REFRESH_FAILED: Record<ShippedLocale, string> = {
  en: "Couldn't refresh this project's secrets. What's shown may be out of date.",
  de: 'Die Secrets dieses Projekts konnten nicht aktualisiert werden. Die Anzeige ist womöglich veraltet.',
  fr: "Impossible d'actualiser les secrets de ce projet. L'affichage n'est peut-être plus à jour.",
};
const TRY_AGAIN: Record<ShippedLocale, string> = {
  en: 'Try again',
  de: 'Erneut versuchen',
  fr: 'Réessayer',
};

// The static page chrome stacks the StickySectionHeader (h2) above the
// Alert's fixed level-5 heading; in the app the tab sits under the page's
// h1/h2. Suppress only that one rule, as the tab's other suites do.
const NO_HEADING_ORDER = { rules: { 'heading-order': { enabled: false } } };

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState(
    {},
    '',
    '/dashboard/org-1/projects/proj-1/secrets',
  );
  backend = syntheticBackend();
  // No backoff between the policy's attempts; the attempt count is real.
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function renderTab() {
  return render(
    <QueryClientProvider client={client}>
      <ProjectSecretsTab organizationId="org-1" projectId="proj-1" />
    </QueryClientProvider>,
  );
}

const t = (key: string) => i18n.t(key, { ns: 'projectSecrets' });
const envEditor = (key: string) => i18n.t(key, { ns: 'envEditor' });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const environment = () => screen.getByRole('group', { name: t('title') });

/** The live alert a message sits in. The page's agent-access notice is a
 * live alert too, so the failure is found by its words. */
async function alertSaying(message: string): Promise<HTMLElement> {
  const words = await screen.findByText(message);
  const alert = words.closest<HTMLElement>('[role="alert"]');
  if (alert === null) throw new Error(`"${message}" is not in an alert`);
  return alert;
}

/** Nothing of the editor is offered: no row, no Add, no Save. */
function expectNoEditor() {
  expect(
    screen.queryByRole('button', { name: envEditor('add') }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: envEditor('save') }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryAllByPlaceholderText(envEditor('keyPlaceholder')),
  ).toHaveLength(0);
}

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

describe('ProjectSecretsTab when its read fails', { timeout: 30_000 }, () => {
  it('names a failed read with Try again, never an empty editor to add over', async () => {
    backend.on(SECRETS, () => serviceUnavailable());
    const { container } = renderTab();

    const alert = await alertSaying(t('errors.loadFailed'));
    // The policy's four attempts, then the failure, in a live region.
    expect(backend.count(SECRETS)).toBe(4);
    expect(
      within(alert).getByRole('button', { name: tryAgain() }),
    ).toBeEnabled();
    // Nothing stored is known, so nothing can be added, removed or saved
    // over it — and nothing was written.
    expectNoEditor();
    expect(backend.count(WRITES)).toBe(0);
    // The page is still the Environment page, not an access refusal.
    expect(
      screen.getByRole('heading', { name: t('title') }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(t('errors.accessDeniedTitle')),
    ).not.toBeInTheDocument();

    await checkAccessibility(container, NO_HEADING_ORDER);
  });

  it('sends no write over secrets it could not read, whatever is clicked', async () => {
    backend.on(SECRETS, () => serviceUnavailable());
    // The store would take any write.
    backend.on(WRITES, () => Response.json({ ok: true }));
    const { user } = renderTab();
    await waitFor(() => expect(backend.count(SECRETS)).toBe(4));
    await waitFor(() => expect(client.isFetching()).toBe(0));

    // The harm #3887 names: over an empty list, re-adding a stored name and
    // saving overwrites that secret. Try it with whatever the tab offers.
    for (const add of screen.queryAllByRole('button', {
      name: envEditor('add'),
    })) {
      await user.click(add);
      await user.type(
        screen.getByPlaceholderText(envEditor('keyPlaceholder')),
        'SYNTHETIC_API_TOKEN',
      );
      await user.type(
        screen.getByPlaceholderText(envEditor('valuePlaceholder')),
        'synthetic-placeholder',
      );
      await user.click(screen.getByRole('button', { name: envEditor('save') }));
      await waitFor(() => expect(backend.count(WRITES)).toBeGreaterThan(0));
    }
    expect(backend.calls.filter((call) => WRITES.test(call))).toEqual([]);
  });

  it('keeps Try again focused and busy through a retry that fails again, then hands the focus to the loaded editor', async () => {
    backend.on(SECRETS, () => serviceUnavailable());
    const { user } = renderTab();
    const alert = await alertSaying(t('errors.loadFailed'));
    const retry = within(alert).getByRole('button', { name: tryAgain() });
    const failure = within(alert).getByText(t('errors.loadFailed'));

    // From the keyboard, with the retry's first attempt held open.
    const release = holdNext(SECRETS);
    retry.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
    // While it runs the failure stays named and no editor appears: the
    // alert, its sentence and Try again are the same nodes, and Try again
    // keeps the focus.
    expect(within(alert).getByText(t('errors.loadFailed'))).toBe(failure);
    expectNoEditor();
    expect(retry).toHaveFocus();

    // It fails again: the sentence is put back as a new node, which the
    // live region announces afresh; Try again keeps its node and focus.
    backend.on(SECRETS, () => serviceUnavailable());
    release();
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
    expect(backend.count(SECRETS)).toBe(8);
    const announced = within(alert).getByText(t('errors.loadFailed'));
    expect(announced).not.toBe(failure);
    expect(within(alert).getByRole('button', { name: tryAgain() })).toBe(retry);
    expect(retry).toHaveFocus();
    expectNoEditor();

    // It answers: the editor shows what is stored, the alert goes, and its
    // focus lands on the Environment group, not on the page.
    backend.on(SECRETS, storedSecrets('SYNTHETIC_API_TOKEN'));
    await user.keyboard('{Enter}');
    expect(
      await screen.findByDisplayValue('SYNTHETIC_API_TOKEN'),
    ).toBeInTheDocument();
    expect(screen.queryByText(t('errors.loadFailed'))).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: envEditor('add') }),
    ).toBeEnabled();
    await waitFor(() => expect(environment()).toHaveFocus());
    expect(backend.count(WRITES)).toBe(0);
  });

  it('keeps the empty editor for a project with no secrets', async () => {
    backend.on(SECRETS, storedSecrets());
    renderTab();

    // Add is there, disabled, while the read runs; the answer enables it.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: envEditor('add') }),
      ).toBeEnabled(),
    );
    expect(backend.count(SECRETS)).toBe(1);
    expect(screen.queryByText(t('errors.loadFailed'))).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: tryAgain() }),
    ).not.toBeInTheDocument();
  });

  it('keeps the access notice for a refusal, with no Try again', async () => {
    backend.on(SECRETS, () =>
      Response.json({ error: 'PROJECT_FORBIDDEN' }, { status: 403 }),
    );
    renderTab();

    expect(
      await screen.findByText(t('errors.accessDeniedTitle')),
    ).toBeInTheDocument();
    // A refusal is not retried, and is not a failure to try again.
    expect(backend.count(SECRETS)).toBe(1);
    expect(screen.queryByText(t('errors.loadFailed'))).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: tryAgain() }),
    ).not.toBeInTheDocument();
    expectNoEditor();
  });

  it('keeps the editor and its draft through a refresh that fails, under a notice with Try again', async () => {
    backend.on(SECRETS, storedSecrets('SYNTHETIC_API_TOKEN'));
    const { user } = renderTab();
    await screen.findByDisplayValue('SYNTHETIC_API_TOKEN');

    // A draft row, not yet saved.
    await user.click(screen.getByRole('button', { name: envEditor('add') }));
    const [, name] = screen.getAllByPlaceholderText(
      envEditor('keyPlaceholder'),
    );
    if (name === undefined) throw new Error('no draft row');
    await user.type(name, 'SYNTHETIC_DRAFT');

    // A background re-read fails: what was loaded stays, with the draft.
    backend.on(SECRETS, () => serviceUnavailable());
    await act(() => client.invalidateQueries());
    const alert = await alertSaying(t('errors.refreshFailed'));
    expect(backend.count(SECRETS)).toBe(5);
    expect(screen.getByDisplayValue('SYNTHETIC_API_TOKEN')).toBeInTheDocument();
    expect(screen.getByDisplayValue('SYNTHETIC_DRAFT')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: envEditor('save') }),
    ).toBeEnabled();

    // Try again clears the notice once the read answers; the draft stays.
    backend.on(SECRETS, storedSecrets('SYNTHETIC_API_TOKEN'));
    await user.click(within(alert).getByRole('button', { name: tryAgain() }));
    await waitFor(() =>
      expect(
        screen.queryByText(t('errors.refreshFailed')),
      ).not.toBeInTheDocument(),
    );
    expect(backend.count(SECRETS)).toBe(6);
    expect(screen.getByDisplayValue('SYNTHETIC_DRAFT')).toBeInTheDocument();
    await waitFor(() => expect(environment()).toHaveFocus());
    expect(backend.count(WRITES)).toBe(0);
  });

  describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
    it('says the read failed in the reader’s language', async () => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      backend.on(SECRETS, () => serviceUnavailable());
      renderTab();

      const alert = await alertSaying(LOAD_FAILED[locale]);
      expect(
        within(alert).getByRole('button', { name: TRY_AGAIN[locale] }),
      ).toBeInTheDocument();
      expect(t('errors.refreshFailed')).toBe(REFRESH_FAILED[locale]);
    });
  });
});

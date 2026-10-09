import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
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

import { MattersSection } from './matters-section';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #3837: the whole read lane runs for real here — `useLegalMatters`,
// `useBackendQuery`, the adapter row, `backendFetch` and the read retry
// policy — against a closed synthetic transport, so the same mounted section
// can be watched failing, retrying and recovering. react-query restarts a
// read that never answered from `pending`, with no error, for the length of
// each retry; the alert and its focused Try again must hold through it.

vi.mock('@/app/hooks/use-session-user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-session-user')>()),
  useSessionUser: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
  useAbilityLoading: () => false,
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
// The dialogs stay closed here; their writes are not under test.
vi.mock('./upsert-matter-dialog', () => ({ UpsertMatterDialog: () => null }));
vi.mock('./close-matter-dialog', () => ({ CloseMatterDialog: () => null }));

const MATTERS =
  /^GET \/api\/app\/legal-holds\/matters\?status=all&orgId=org-1$/;
const MATTER = {
  _id: 'm1',
  organizationId: 'org-1',
  name: 'Acme v. Globex',
  caseNumber: 'CASE-1',
  status: 'open',
  createdBy: 'user-1',
  createdByName: 'Alice',
  createdAt: Date.UTC(2026, 9, 1, 10),
  linkedActiveHolds: 1,
};

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState(
    {},
    '',
    '/dashboard/org-1/settings/governance/legal-hold',
  );
  backend = syntheticBackend();
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});
afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
});

describe('MattersSection read recovery on the real read lane (#3837)', () => {
  it('names a 503 read, keeps Try again focused through repeated and pending retries, then focuses the section', async () => {
    backend.on(MATTERS, () => serviceUnavailable());
    const { user } = render(
      <QueryClientProvider client={client}>
        <MattersSection organizationId="org-1" />
      </QueryClientProvider>,
    );
    const message = await screen.findByText("Couldn't load the matters.");
    const alert = message.closest('[role="alert"]') as HTMLElement;
    expect(alert).not.toBeNull();
    expect(backend.count(MATTERS)).toBe(4);
    expect(screen.queryByText('No matters')).not.toBeInTheDocument();

    // A repeated failure keeps the focused Try again.
    const retry = within(alert).getByRole('button', { name: 'Try again' });
    retry.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(backend.count(MATTERS)).toBe(8));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveFocus();

    // A retry held open: the alert and the focused button stay, busy.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    backend.on(MATTERS, async () => {
      await held;
      return Response.json({ matters: [MATTER] });
    });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(backend.count(MATTERS)).toBe(9));
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No matters')).not.toBeInTheDocument();

    release();
    expect(await screen.findByText('Acme v. Globex')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Matters' })).toHaveFocus(),
    );
  });
});

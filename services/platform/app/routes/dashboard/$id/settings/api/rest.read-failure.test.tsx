import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiKey } from '@/app/features/settings/api-keys/types';
import { onSessionLapsed } from '@/app/lib/auth/session-lapse';
import type { MemberContextView } from '@/app/lib/backend/org';
import { i18n } from '@/lib/i18n/i18n';
import { LAPSED_SESSION_ANSWER } from '@/tests/utils/lapsed-session';
import { configure, render, screen, waitFor } from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

// A failure settles after four attempts; on a loaded runner that outlasts
// the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #3676: the page read only the keys' data, so a list read that failed
// before anything loaded handed the table `undefined` — which it shows as a
// list still loading. The skeleton stayed after the request had settled,
// with no failure named and no way to try again. The page runs for real here
// (`useApiKeys`, `apiKeysQuery`, `backendFetch`, `ApiKeysTable` and its
// DataTable) against a closed synthetic transport. The client keeps the
// library's three retries, the number the app's policy (`app/router.tsx`)
// gives both failures here: a fault, and a refusal with no structured
// payload.

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  ...(await import('@/tests/utils/router-link-stub')).routerLinkStub,
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useParams: () => ({ id: 'org-1' }),
  }),
}));
// Who may create keys, and for whom, have their own suites: here a member
// who may create their own.
vi.mock(
  '@/app/features/settings/model-endpoints/hooks/use-api-settings-access',
  () => ({ useApiSettingsAccess: () => ({ createApiKeys: true }) }),
);
// Who reads the page: not yet known, unless a test says.
const view = vi.hoisted(() => ({
  memberContext: undefined as MemberContextView | undefined,
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: view.memberContext }),
}));
// The create dialog has its own suites, and stays closed here.
vi.mock(
  '@/app/features/settings/api-keys/components/api-key-create-dialog',
  () => ({ ApiKeyCreateDialog: () => null }),
);
// The personal keys notice and setting have their own suites, and read
// nothing here: the page only places them, for the reader they are for.
vi.mock(
  '@/app/features/settings/api-keys/components/personal-keys-notice',
  () => ({
    PersonalKeysNotice: ({ organizationId }: { organizationId: string }) => (
      <p>{`Personal keys notice for ${organizationId}`}</p>
    ),
  }),
);
vi.mock(
  '@/app/features/settings/api-keys/components/personal-keys-policy-editor',
  () => ({
    PersonalKeysPolicyEditor: ({
      organizationId,
    }: {
      organizationId: string;
    }) => <p>{`Personal keys setting for ${organizationId}`}</p>,
  }),
);

const { Route } = await import('./rest');
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- createFileRoute is mocked to return the config
const ApiRestPage = (
  Route as unknown as { component: () => React.ReactElement }
).component;

const KEYS = /^GET \/api\/app\/api-keys\?orgId=org-1$/;
const KEY_NAME = 'CI deploy key';
const CI_KEY: ApiKey = {
  id: 'key-1',
  name: KEY_NAME,
  start: 'tale_abc',
  prefix: 'tale_',
  suffix: 'wxyz',
  enabled: true,
  expiresAt: null,
  createdAt: Date.UTC(2026, 0, 5),
  lastRequest: null,
  owner: { kind: 'user' },
  role: null,
  createdBy: null,
  canRevoke: true,
};

let backend: SyntheticBackend;
let client: QueryClient;
let stopListening: (() => void) | undefined;

beforeEach(() => {
  view.memberContext = undefined;
  backend = syntheticBackend();
  // No backoff between the attempts; their number is unchanged.
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(() => {
  stopListening?.();
  stopListening = undefined;
  client.clear();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <QueryClientProvider client={client}>
      <ApiRestPage />
    </QueryClientProvider>,
  );
}

const failed = () => i18n.t('errors.somethingWentWrong', { ns: 'common' });
const tryAgain = () => i18n.t('errors.tryAgain', { ns: 'common' });
const emptyTitle = () => i18n.t('apiKeys.title', { ns: 'emptyStates' });
const createKey = () => i18n.t('apiKeys.createKey', { ns: 'settings' });
/** The table's loading skeleton is the only part of the page marked busy. */
const busy = () => document.querySelector('[aria-busy="true"]');

describe(
  'the API keys page when its list read fails',
  { timeout: 30_000 },
  () => {
    it('names the failure with Try again instead of a skeleton, and recovers on Try again', async () => {
      backend.on(KEYS, () => serviceUnavailable());
      const { user } = renderPage();

      const retry = await screen.findByRole('button', { name: tryAgain() });
      // Four attempts, then the error state: not the skeleton, and not the
      // empty list's state either.
      expect(backend.count(KEYS)).toBe(4);
      expect(
        screen.getByRole('heading', { name: failed() }),
      ).toBeInTheDocument();
      expect(busy()).toBeNull();
      expect(screen.queryByText(emptyTitle())).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: createKey() }),
      ).not.toBeInTheDocument();

      // Try again re-runs the same read on the same mounted page.
      backend.on(KEYS, () => Response.json({ keys: [CI_KEY] }));
      await user.click(retry);
      expect(await screen.findByText(KEY_NAME)).toBeInTheDocument();
      expect(backend.count(KEYS)).toBe(5);
      expect(backend.calls).toHaveLength(5);
      expect(
        screen.queryByRole('button', { name: tryAgain() }),
      ).not.toBeInTheDocument();
      expect(busy()).toBeNull();
    });

    it('names a read refused for a lapsed session as a failure too, and reports the lapse', async () => {
      // The dashboard layout's sign-in prompt (`useSessionLapseRedirect`)
      // listens for this report; the layout is not mounted here.
      const lapsed = vi.fn();
      stopListening = onSessionLapsed(lapsed);
      backend.on(KEYS, () =>
        Response.json(LAPSED_SESSION_ANSWER.body, {
          status: LAPSED_SESSION_ANSWER.status,
        }),
      );
      renderPage();

      expect(
        await screen.findByRole('button', { name: tryAgain() }),
      ).toBeInTheDocument();
      // Retried like the fault above before the failure shows.
      expect(backend.count(KEYS)).toBe(4);
      expect(lapsed).toHaveBeenCalled();
      expect(
        screen.getByRole('heading', { name: failed() }),
      ).toBeInTheDocument();
      expect(busy()).toBeNull();
      expect(screen.queryByText(emptyTitle())).not.toBeInTheDocument();
    });

    it('keeps the skeleton while the first read is on its way', async () => {
      let answer: (response: Response) => void = () => {};
      backend.on(
        KEYS,
        () => new Promise<Response>((resolve) => (answer = resolve)),
      );
      renderPage();

      await waitFor(() => expect(backend.count(KEYS)).toBe(1));
      expect(busy()).not.toBeNull();
      expect(
        screen.queryByRole('button', { name: tryAgain() }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(emptyTitle())).not.toBeInTheDocument();

      answer(Response.json({ keys: [CI_KEY] }));
      expect(await screen.findByText(KEY_NAME)).toBeInTheDocument();
      expect(busy()).toBeNull();
    });

    it('keeps the empty state, with its Create action, for a list that is really empty', async () => {
      backend.on(KEYS, () => Response.json({ keys: [] }));
      renderPage();

      expect(await screen.findByText(emptyTitle())).toBeInTheDocument();
      expect(screen.getByRole('button', { name: createKey() })).toBeEnabled();
      expect(
        screen.queryByRole('button', { name: tryAgain() }),
      ).not.toBeInTheDocument();
      expect(busy()).toBeNull();
      expect(backend.count(KEYS)).toBe(1);
    });
  },
);

const MEMBER = {
  status: 'ok',
  memberId: 'member-1',
  organizationId: 'org-1',
  userId: 'user-1',
  role: 'member',
  createdAt: Date.UTC(2026, 0, 5),
  displayName: undefined,
  isAdmin: false,
} satisfies MemberContextView;
const NOTICE = 'Personal keys notice for org-1';
const SETTING = 'Personal keys setting for org-1';
/** The keys section's own heading, which the page orders the rest around. */
const keysHeading = () =>
  screen.getByRole('heading', {
    name: i18n.t('apiKeys', { ns: 'navigation' }),
  });

describe("the API keys page and members' personal keys", () => {
  it('shows an Owner or Admin the setting below the keys, and no notice', async () => {
    view.memberContext = { ...MEMBER, role: 'admin', isAdmin: true };
    backend.on(KEYS, () => Response.json({ keys: [] }));
    renderPage();

    expect(await screen.findByText(emptyTitle())).toBeInTheDocument();
    const setting = screen.getByText(SETTING);
    expect(
      keysHeading().compareDocumentPosition(setting) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it('shows a member the notice above the keys, and no setting', async () => {
    view.memberContext = MEMBER;
    backend.on(KEYS, () => Response.json({ keys: [] }));
    renderPage();

    expect(await screen.findByText(emptyTitle())).toBeInTheDocument();
    const notice = screen.getByText(NOTICE);
    expect(
      keysHeading().compareDocumentPosition(notice) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    expect(screen.queryByText(SETTING)).not.toBeInTheDocument();
  });

  it('shows neither before it knows who reads the page', async () => {
    backend.on(KEYS, () => Response.json({ keys: [] }));
    renderPage();

    expect(await screen.findByText(emptyTitle())).toBeInTheDocument();
    expect(screen.queryByText(SETTING)).not.toBeInTheDocument();
    // An Owner or Admin never sees the member's notice flash first.
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});

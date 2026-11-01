import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { i18n } from '@/tests/utils/i18n-all-languages';
import {
  configure,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { Route } from './route';

// #4767: a member whose API access read failed was told the section was not
// theirs (Access denied, or a tab's refusal), with nothing to try again. The
// layout's reads run for real here — the access hook, the adapter rows,
// `backendFetch` and the read retry policy — against a closed synthetic
// transport, so one read can fail, heal and be asked again on the same
// mounted layout. Only the role and the router around the layout are set.

const view = vi.hoisted(() => ({
  developer: false,
  path: '/dashboard/org-1/settings/api/rest',
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useParams: () => ({ id: 'org-1' }),
  }),
  // The tab's own route: which page opens is the layout's decision.
  Outlet: () => <p>{`Opened ${view.path}`}</p>,
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: view.path } }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: (action: string, subject: string) =>
      view.developer && action === 'read' && subject === 'developerSettings',
  }),
  useAbilityLoading: () => false,
}));

// Which tabs the phone's strip lists is the layout's; how it lays them out
// is the strip's own suite.
vi.mock('@/app/components/navigation/tab-navigation', () => ({
  TabNavigation: ({
    items,
    ariaLabel,
  }: {
    items: Array<{ label: string; href: string }>;
    ariaLabel?: string;
  }) => (
    <nav aria-label={ariaLabel}>
      {items.map((item) => (
        <a key={item.href} href={item.href}>
          {item.label}
        </a>
      ))}
    </nav>
  ),
}));

// The router mock replaces `createFileRoute`, so `Route` is the plain config
// object, component included.
const ApiSettingsLayout = (
  Route as unknown as { component: () => ReactElement }
).component;

const MODEL_API = /^GET \/api\/app\/governance\/my\/model-api\?orgId=org-1$/;
const KEY_ACCESS = /^GET \/api\/app\/governance\/my\/api-keys\?orgId=org-1$/;
const AGENT_ACCESS = /^GET \/api\/app\/agent-connections\/access\?orgId=org-1$/;

interface Answers {
  allowed: boolean;
  mayCreate: boolean;
  holdsKeys: boolean;
  mayConnect: boolean;
  holdsConnection: boolean;
}

const NO_GRANT: Answers = {
  allowed: false,
  mayCreate: false,
  holdsKeys: false,
  mayConnect: false,
  holdsConnection: false,
};
// A member an Admin granted a right that is used with a key (Export
// notifications), who holds the key they made with it.
const KEY_GRANT: Answers = { ...NO_GRANT, mayCreate: true, holdsKeys: true };
// One granted Call models over the API, a right used with a key too.
const MODEL_GRANT: Answers = { ...NO_GRANT, allowed: true, mayCreate: true };

/** Each access read answers healthy, from now on. */
function answer(backend: SyntheticBackend, grants: Answers) {
  backend.on(MODEL_API, () =>
    Response.json({ enabled: true, allowed: grants.allowed, models: [] }),
  );
  backend.on(KEY_ACCESS, () =>
    Response.json({
      mayCreate: grants.mayCreate,
      holdsKeys: grants.holdsKeys,
      personalKeys: 'admitted',
    }),
  );
  backend.on(AGENT_ACCESS, () =>
    Response.json({
      mayConnect: grants.mayConnect,
      holdsConnection: grants.holdsConnection,
      signInOn: true,
    }),
  );
}

/** A fault rather than an answer: the read retry policy tries four times. */
function internalError() {
  return Response.json(
    { error: 'Internal error', code: 'INTERNAL' },
    { status: 500 },
  );
}

const tSettings = () => i18n.getFixedT('en', 'settings');
const tDenied = () => i18n.getFixedT('en', 'accessDenied');
const tryAgain = () => i18n.getFixedT('en', 'common')('actions.tryAgain');
const opened = () => `Opened ${view.path}`;

/** Every sentence that closes the section or one of its tabs. */
function expectNoRefusal() {
  for (const key of ['apiKeys', 'apiTab', 'apiModels', 'apiAgents']) {
    expect(screen.queryByText(tDenied()(key))).toBeNull();
  }
}

function listedTabs() {
  return within(screen.getByRole('navigation', { name: 'API' }))
    .getAllByRole('link')
    .map((link) => link.textContent);
}

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

describe('API settings layout', { timeout: 30_000 }, () => {
  let backend: SyntheticBackend;
  let client: QueryClient;

  function open(path: string) {
    view.path = path;
    // The adapter rows read the organization from the address.
    window.history.replaceState({}, '', path);
  }

  function renderLayout() {
    return render(
      <QueryClientProvider client={client}>
        <ApiSettingsLayout />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    view.developer = false;
    open('/dashboard/org-1/settings/api/rest');
    backend = syntheticBackend();
    // No backoff between the policy's attempts; the attempt count is real.
    client = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
    });
  });

  afterEach(() => {
    client.clear();
    vi.restoreAllMocks();
  });

  it('opens REST to a member with a key grant', async () => {
    answer(backend, KEY_GRANT);
    renderLayout();

    expect(await screen.findByText(opened())).toBeInTheDocument();
    expect(listedTabs()).toEqual(['REST']);
    expect(screen.queryByText(tSettings()('apiAccess.readFailed'))).toBeNull();
    expect(
      screen.queryByText(tSettings()('apiAccess.partialReadFailed')),
    ).toBeNull();
  });

  it('still refuses a member whose reads open no tab', async () => {
    answer(backend, NO_GRANT);
    renderLayout();

    expect(await screen.findByText(tDenied()('apiKeys'))).toBeInTheDocument();
    expect(screen.queryByText(tSettings()('apiAccess.readFailed'))).toBeNull();
  });

  it.each([
    {
      read: 'key rule',
      failing: KEY_ACCESS,
      // Nothing else opens REST for this member: the page waits on it.
      message: 'apiAccess.readFailed',
      restMeanwhile: false,
    },
    {
      read: 'model grant',
      failing: MODEL_API,
      // The key rule opens REST; Models is the one it leaves undecided.
      message: 'apiAccess.partialReadFailed',
      restMeanwhile: true,
    },
    {
      read: 'connections',
      failing: AGENT_ACCESS,
      message: 'apiAccess.partialReadFailed',
      restMeanwhile: true,
    },
  ])(
    'names a failed $read read with Try again, never a refusal, and shows REST once it answers',
    async ({ failing, message, restMeanwhile }) => {
      answer(backend, KEY_GRANT);
      backend.on(failing, internalError);
      const { user } = renderLayout();

      expect(await screen.findByText(tSettings()(message))).toBeInTheDocument();
      expectNoRefusal();
      expect(screen.queryByText(opened()) !== null).toBe(restMeanwhile);
      expect(backend.count(failing)).toBe(4);

      answer(backend, KEY_GRANT);
      await user.click(screen.getByRole('button', { name: tryAgain() }));

      expect(await screen.findByText(opened())).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByText(tSettings()(message))).toBeNull(),
      );
      expectNoRefusal();
      expect(backend.count(failing)).toBe(5);
    },
  );

  it('names the failure while both grant reads fail, and shows REST once they answer', async () => {
    answer(backend, KEY_GRANT);
    backend.on(MODEL_API, internalError);
    backend.on(KEY_ACCESS, internalError);
    const { user } = renderLayout();

    expect(
      await screen.findByText(tSettings()('apiAccess.readFailed')),
    ).toBeInTheDocument();
    expectNoRefusal();
    // REST and Models stay listed: either may be the member's.
    expect(listedTabs()).toEqual(['REST', 'Models']);

    answer(backend, KEY_GRANT);
    await user.click(screen.getByRole('button', { name: tryAgain() }));

    expect(await screen.findByText(opened())).toBeInTheDocument();
    expect(listedTabs()).toEqual(['REST']);
    expect(backend.count(MODEL_API)).toBe(5);
    expect(backend.count(KEY_ACCESS)).toBe(5);
  });

  it('lists Models beside REST while the model grant read fails, and names the failure there', async () => {
    open('/dashboard/org-1/settings/api/models');
    answer(backend, MODEL_GRANT);
    backend.on(MODEL_API, internalError);
    const { user } = renderLayout();

    expect(
      await screen.findByText(tSettings()('apiAccess.readFailed')),
    ).toBeInTheDocument();
    expectNoRefusal();
    expect(screen.queryByText(opened())).toBeNull();
    expect(listedTabs()).toEqual(['REST', 'Models']);

    answer(backend, MODEL_GRANT);
    await user.click(screen.getByRole('button', { name: tryAgain() }));

    expect(await screen.findByText(opened())).toBeInTheDocument();
    expect(listedTabs()).toEqual(['REST', 'Models']);
  });

  it('names a failed connections read on Connected agents instead of refusing it', async () => {
    open('/dashboard/org-1/settings/api/agents');
    answer(backend, { ...NO_GRANT, holdsConnection: true });
    backend.on(AGENT_ACCESS, internalError);
    const { user } = renderLayout();

    expect(
      await screen.findByText(tSettings()('apiAccess.readFailed')),
    ).toBeInTheDocument();
    expectNoRefusal();

    answer(backend, { ...NO_GRANT, holdsConnection: true });
    await user.click(screen.getByRole('button', { name: tryAgain() }));

    expect(await screen.findByText(opened())).toBeInTheDocument();
    expect(listedTabs()).toEqual(['Connected agents']);
  });

  it('refuses a tab the role closes, whatever read failed', async () => {
    open('/dashboard/org-1/settings/api/mcp');
    answer(backend, KEY_GRANT);
    backend.on(MODEL_API, internalError);
    backend.on(KEY_ACCESS, internalError);
    renderLayout();

    expect(await screen.findByText(tDenied()('apiTab'))).toBeInTheDocument();
    expect(screen.queryByText(tSettings()('apiAccess.readFailed'))).toBeNull();
  });

  it('refuses Models once its read answers no, while another read still fails', async () => {
    open('/dashboard/org-1/settings/api/models');
    answer(backend, KEY_GRANT);
    backend.on(KEY_ACCESS, internalError);
    renderLayout();

    expect(await screen.findByText(tDenied()('apiModels'))).toBeInTheDocument();
  });

  it('changes nothing for a developer role whose grant reads fail', async () => {
    view.developer = true;
    answer(backend, { ...NO_GRANT, mayConnect: true });
    backend.on(MODEL_API, internalError);
    backend.on(KEY_ACCESS, internalError);
    renderLayout();

    expect(await screen.findByText(opened())).toBeInTheDocument();
    expect(listedTabs()).toEqual([
      'REST',
      'Models',
      'MCP',
      'Connected agents',
      'WebDAV',
    ]);
    expect(
      screen.queryByText(tSettings()('apiAccess.partialReadFailed')),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: tryAgain() })).toBeNull();
  });

  it('keeps Try again and its focus through a retry that fails again, then hands the focus to the section', async () => {
    answer(backend, KEY_GRANT);
    backend.on(KEY_ACCESS, internalError);
    const { user } = renderLayout();

    const retry = await screen.findByRole('button', { name: tryAgain() });
    await user.click(retry);
    expect(retry).toHaveFocus();
    // The failure stands through the retry: no skeleton, no refusal.
    await waitFor(() => expect(backend.count(KEY_ACCESS)).toBe(8));
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
    expect(screen.getByRole('button', { name: tryAgain() })).toBe(retry);
    expect(retry).toHaveFocus();
    expectNoRefusal();

    answer(backend, KEY_GRANT);
    await user.click(retry);

    expect(await screen.findByText(opened())).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'API' })).toHaveFocus(),
    );
  });

  it('has no axe violations while the access read fails', async () => {
    answer(backend, KEY_GRANT);
    backend.on(KEY_ACCESS, internalError);
    const { container } = renderLayout();

    await screen.findByText(tSettings()('apiAccess.readFailed'));
    await checkAccessibility(container);
  });
});

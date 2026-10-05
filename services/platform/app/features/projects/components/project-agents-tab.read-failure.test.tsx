import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { act, configure, render, screen, waitFor } from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { ProjectAgentsTab } from './project-agents-tab';

configure({ asyncUtilTimeout: 10_000 });
const state = vi.hoisted(() => ({ canEdit: true, organizationId: 'org-1' }));
vi.mock('../hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/queries')>()),
  useProject: () => ({ project: { canEdit: state.canEdit }, isLoading: false }),
  useProjectHarnesses: () => ({ data: undefined }),
  useProjectCapabilityCatalog: () => ({ data: undefined }),
  useStandardAgent: () => ({ available: false }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => state.organizationId,
}));
vi.mock('../hooks/mutations', () => ({
  useDeleteProjectAgent: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./project-agent-dialog', () => ({ ProjectAgentDialog: () => null }));

const AGENTS = /^GET \/api\/app\/projects\/proj-1\/agents\?orgId=org-1$/;
const WRITES = /^(POST|PUT|PATCH|DELETE) /;
const LOAD_FAILED = {
  en: "Couldn't load this project's agents.",
  de: 'Die Agenten dieses Projekts konnten nicht geladen werden.',
  fr: 'Impossible de charger les agents de ce projet.',
};
let backend: SyntheticBackend;
let client: QueryClient;
const t = (key: string) => i18n.t(key, { ns: 'projects' });
const retryName = () => i18n.t('actions.tryAgain', { ns: 'common' });

beforeEach(() => {
  state.canEdit = true;
  state.organizationId = 'org-1';
  window.history.replaceState(
    {},
    '',
    '/dashboard/org-1/projects/proj-1/agents',
  );
  backend = syntheticBackend();
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
      <ProjectAgentsTab organizationId="org-1" projectId="proj-1" />
    </QueryClientProvider>,
  );
}
function expectNoCreation() {
  expect(
    screen.queryByRole('button', { name: t('agents.newAgent') }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(t('agents.emptyTitle'))).not.toBeInTheDocument();
  expect(backend.count(WRITES)).toBe(0);
}

describe('Project Agents directory read failures', { timeout: 30_000 }, () => {
  it('hides creation until the initial pending read answers, retaining a cached empty answer', async () => {
    let release = () => {};
    backend.on(
      AGENTS,
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(Response.json({ agents: [] }));
        }),
    );
    renderTab();
    await waitFor(() => expect(backend.count(AGENTS)).toBe(1));
    expectNoCreation();
    expect(screen.queryByText(t('agents.emptyBody'))).not.toBeInTheDocument();
    await act(async () => release());
    await screen.findByText(t('agents.emptyTitle'));
    expect(
      screen.getByRole('button', { name: t('agents.newAgent') }),
    ).toBeEnabled();
    backend.on(AGENTS, serviceUnavailable);
    await act(async () => {
      await client.refetchQueries();
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('agents.refreshFailed'),
    );
    expect(screen.getByText(t('agents.emptyTitle'))).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t('agents.newAgent') }),
    ).toBeEnabled();
  });

  it('hides creation while the initial read is disabled', async () => {
    state.organizationId = '';
    renderTab();
    expectNoCreation();
    expect(screen.queryByText(t('agents.emptyBody'))).not.toBeInTheDocument();
    expect(backend.count(AGENTS)).toBe(0);
  });

  it.each(SHIPPED_LOCALES)(
    'names the failure and keeps project context in %s',
    async (locale) => {
      saveLocale(locale);
      backend.on(AGENTS, serviceUnavailable);
      const { container } = renderTab();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        LOAD_FAILED[locale],
      );
      expect(screen.getByRole('button', { name: retryName() })).toBeEnabled();
      expect(
        screen.getByRole('heading', { name: t('agents.agentsHeading') }),
      ).toBeInTheDocument();
      expectNoCreation();
      expect(backend.count(AGENTS)).toBe(4);
      await checkAccessibility(container, {
        rules: { 'heading-order': { enabled: false } },
      });
    },
  );

  it('keeps retry focus through another failure, then recovers an empty list', async () => {
    backend.on(AGENTS, serviceUnavailable);
    const { user } = renderTab();
    await screen.findByRole('alert');
    const retry = screen.getByRole('button', { name: retryName() });
    let release = () => {};
    backend.on(
      AGENTS,
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(serviceUnavailable());
        }),
    );
    await user.click(retry);
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expectNoCreation();
    const count = backend.count(AGENTS);
    await user.click(retry);
    expect(backend.count(AGENTS)).toBe(count);
    backend.on(AGENTS, serviceUnavailable);
    await act(async () => release());
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
    expect(retry).toHaveFocus();
    expectNoCreation();
    backend.on(AGENTS, () => Response.json({ agents: [] }));
    await user.click(retry);
    await screen.findByText(t('agents.emptyTitle'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t('agents.newAgent') }),
    ).toBeEnabled();
    await waitFor(() =>
      expect(
        screen.getByRole('group', { name: t('agents.agentsHeading') }),
      ).toHaveFocus(),
    );
  });

  it('offers readers Retry and recovers rows, retaining them after a failed refresh', async () => {
    state.canEdit = false;
    backend.on(AGENTS, serviceUnavailable);
    const { user } = renderTab();
    await screen.findByRole('alert');
    expectNoCreation();
    backend.on(AGENTS, () =>
      Response.json({
        agents: [
          {
            id: 'agent-1',
            name: 'Existing worker',
            harness: 'test',
            skills: [],
            connectors: [],
            projectId: 'proj-1',
            organizationId: 'org-1',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    );
    await user.click(screen.getByRole('button', { name: retryName() }));
    await screen.findByText('Existing worker');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    backend.on(AGENTS, serviceUnavailable);
    await act(async () => {
      await client.refetchQueries();
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('agents.refreshFailed'),
    );
    expect(screen.getByText('Existing worker')).toBeInTheDocument();
    expectNoCreation();
  });
});

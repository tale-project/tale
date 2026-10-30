import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
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

import { ProjectAgentCreateDialog } from './project-agent-create-dialog';

configure({ asyncUtilTimeout: 10_000 });
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useParams: () => ({ id: 'org-1' }),
}));
vi.mock('./agent-secrets-field', () => ({ AgentSecretsField: () => null }));
vi.mock('../hooks/use-unpinned-serving-preview', () => ({
  useUnpinnedServingPreview: () => ({ data: undefined }),
}));

const CATALOG =
  /^GET \/api\/app\/chat\/composer\/project\/p-1\/capabilities\?orgId=org-1$/;
const LOAD_FAILED = {
  en: "Couldn't load the skills and connectors this project offers.",
  de: 'Die Skills und Connectors dieses Projekts konnten nicht geladen werden.',
  fr: 'Impossible de charger les skills et connectors de ce projet.',
};
const OFFER = {
  skills: [{ slug: 'brief-summary', label: 'Brief summary' }],
  connectors: [],
};
let backend: SyntheticBackend;
let client: QueryClient;
const t = (key: string, ns = 'projects') => i18n.t(key, { ns });
const retryName = () => t('actions.tryAgain', 'common');
const menuTrigger = () =>
  screen.getByRole('button', { name: t('skills.label', 'chat') });

beforeEach(() => {
  window.history.replaceState({}, '', '/dashboard/org-1/projects/p-1');
  backend = syntheticBackend();
  backend.on(/^GET \/api\/app\/chat\/composer\/models\?orgId=org-1$/, () =>
    Response.json({
      harnesses: [{ harness: 'claude-code', label: 'Claude Code' }],
      models: [],
    }),
  );
  backend.on(/^GET \/api\/app\/agent-secrets\?orgId=org-1$/, () =>
    Response.json({ secrets: [] }),
  );
  backend.on(/^GET \/api\/app\/connector-credentials\?orgId=org-1$/, () =>
    Response.json({ credentials: [] }),
  );
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});
afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function renderDialog() {
  return render(
    <QueryClientProvider client={client}>
      <ProjectAgentCreateDialog
        open
        organizationId="org-1"
        projectId="p-1"
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('New agent capability catalog read', { timeout: 30_000 }, () => {
  it('says the catalog is loading until it answers, never that it is empty', async () => {
    let release = () => {};
    backend.on(
      CATALOG,
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(Response.json(OFFER));
        }),
    );
    const { user } = renderDialog();
    await waitFor(() => expect(backend.count(CATALOG)).toBe(1));
    await user.click(menuTrigger());
    expect(
      await screen.findAllByRole('menuitem', {
        name: t('actions.loading', 'common'),
      }),
    ).toHaveLength(2);
    expect(
      screen.queryByText(t('skills.emptySkills', 'chat')),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(t('skills.emptyConnectors', 'chat')),
    ).not.toBeInTheDocument();

    await act(async () => release());
    expect(
      await screen.findByRole('menuitemcheckbox', { name: 'Brief summary' }),
    ).toBeInTheDocument();
    // Answered with no connectors: now, and only now, the group is empty.
    expect(
      screen.getByRole('menuitem', {
        name: t('skills.emptyConnectors', 'chat'),
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: t('actions.loading', 'common') }),
    ).not.toBeInTheDocument();
  });

  it.each(SHIPPED_LOCALES)(
    'names a failed read and offers Try again in %s',
    async (locale) => {
      saveLocale(locale);
      backend.on(CATALOG, serviceUnavailable);
      renderDialog();
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(LOAD_FAILED[locale]);
      expect(
        within(alert).getByRole('button', { name: retryName() }),
      ).toBeEnabled();
      expect(backend.count(CATALOG)).toBe(4);
      await checkAccessibility(screen.getByRole('dialog'));
    },
  );

  it('keeps Try again inert while it runs, then lists the recovered catalog and hands the focus to the menu', async () => {
    backend.on(CATALOG, serviceUnavailable);
    const { user } = renderDialog();
    const alert = await screen.findByRole('alert');
    const retry = within(alert).getByRole('button', { name: retryName() });
    let release = () => {};
    backend.on(
      CATALOG,
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(Response.json(OFFER));
        }),
    );
    await user.click(retry);
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    const count = backend.count(CATALOG);
    await user.click(retry);
    expect(backend.count(CATALOG)).toBe(count);

    await act(async () => release());
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(menuTrigger()).toHaveFocus());
    await user.click(menuTrigger());
    expect(
      await screen.findByRole('menuitemcheckbox', { name: 'Brief summary' }),
    ).toBeInTheDocument();
  });

  it('keeps the last answer listed when a refresh fails, and says it may be out of date', async () => {
    backend.on(CATALOG, () => Response.json(OFFER));
    const { user } = renderDialog();
    await user.click(menuTrigger());
    await screen.findByRole('menuitemcheckbox', { name: 'Brief summary' });
    await user.keyboard('{Escape}');

    backend.on(CATALOG, serviceUnavailable);
    await act(async () => {
      await client.refetchQueries();
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('agents.equipmentRefreshFailed'),
    );
    await user.click(menuTrigger());
    expect(
      await screen.findByRole('menuitemcheckbox', { name: 'Brief summary' }),
    ).toBeInTheDocument();
  });
});

import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import type { TemplateCard, TemplateDetail } from '../lib/templates';
import { TemplateCatalogDialog } from './template-catalog-dialog';

const REVIEWER: TemplateCard = {
  slug: 'notify-reviewer',
  name: 'Tell the reviewer',
  description: 'Tells a member when a task of a project moves to In review.',
  icon: 'bell-ring',
  category: 'notifications',
  labels: [],
  details:
    'When a task of the project you pick moves to In review, the member you choose is told.',
  i18n: {
    de: {
      name: 'Reviewer benachrichtigen',
      description: 'Benachrichtigt ein Mitglied.',
      details: 'Wechselt eine Aufgabe in den Status „In Prüfung“, …',
    },
  },
  scope: 'project',
  steps: [
    {
      title: 'Watches the project’s status changes',
      detail: 'Every status change of a task in the project you pick.',
    },
    { title: 'Tells the reviewer' },
  ],
  outcomes: [
    { kind: 'sends', text: 'A message to the reviewer for each task.' },
    { kind: 'never', text: 'Never changes the task.' },
  ],
  worksWith: [],
  fields: [
    { id: 'project', kind: 'project', label: 'Project' },
    {
      id: 'reviewer',
      kind: 'member',
      label: 'Reviewer',
      description: 'Who is told when a task is ready for review.',
    },
    {
      id: 'message',
      kind: 'text',
      label: 'Message',
      default: 'This task is ready for your review.',
      maxLength: 500,
    },
  ],
  connectors: [
    { slug: 'task', connected: true, platform: true },
    { slug: 'notify', connected: true, platform: true },
  ],
  trigger: { kind: 'event', event: 'task.status_changed' },
  inUse: 0,
};

const WEBHOOK: TemplateCard = {
  slug: 'webhook-create-task',
  name: 'Create tasks from a webhook',
  description: 'Creates a task for each delivery.',
  icon: 'webhook',
  category: 'webhooks',
  labels: [],
  details: 'Another system sends JSON to the webhook address.',
  i18n: {},
  scope: 'project',
  steps: [{ title: 'Receives a delivery' }],
  outcomes: [{ kind: 'creates', text: 'A task for each delivery.' }],
  worksWith: [],
  fields: [{ id: 'project', kind: 'project', label: 'Project' }],
  connectors: [{ slug: 'task', connected: true, platform: true }],
  trigger: { kind: 'webhook' },
  inUse: 2,
};

const SYNC: TemplateCard = {
  slug: 'github/sync-issues',
  name: 'Sync GitHub issues',
  description: 'Keeps a project’s tasks in step with a repository’s issues.',
  icon: 'brand:github',
  category: 'issues',
  labels: ['GitHub'],
  details: 'On its schedule, new issues become tasks.',
  i18n: {},
  scope: 'org',
  steps: [{ title: 'Reads the repository’s issues' }],
  outcomes: [
    { kind: 'creates', text: 'A task for each new issue.' },
    { kind: 'never', text: 'Never writes to GitHub.' },
  ],
  worksWith: ['notify-reviewer'],
  fields: [
    {
      id: 'repository',
      kind: 'text',
      label: 'Repository',
      placeholder: 'owner/name',
      pattern: '[\\w.-]+/[\\w.-]+',
    },
    {
      id: 'batch',
      kind: 'number',
      label: 'Issues per run',
      min: 1,
      max: 100,
      default: 25,
    },
    { id: 'closed', kind: 'toggle', label: 'Closed issues too' },
    { id: 'labels', kind: 'list', label: 'Labels' },
    {
      id: 'account',
      kind: 'credential',
      label: 'Account',
      connector: 'github',
    },
    {
      id: 'backup',
      kind: 'credential',
      label: 'Fallback account',
      connector: 'github',
      required: false,
      placeholder: 'The default GitHub connection',
    },
    { id: 'schedule', kind: 'schedule', label: 'When' },
  ],
  connectors: [
    { slug: 'github', connected: false, platform: false },
    { slug: 'task', connected: true, platform: true },
  ],
  trigger: {
    kind: 'schedule',
    repeat: { frequency: 'hourly', interval: 1, minute: 0 },
    cron: null,
    timezone: 'UTC',
  },
  inUse: 0,
};

function detailOf(card: TemplateCard): TemplateDetail {
  return {
    ...card,
    document: {
      version: 1,
      name: card.slug.replaceAll('/', '-'),
      nodes: [{ id: 'first', type: 'transform', code: 'return 1;' }],
    },
    credentials: card.slug === SYNC.slug ? catalog.githubCredentials : {},
  };
}

const { catalog, create, navigate, refetchDetail } = vi.hoisted(() => ({
  catalog: {
    cards: [] as TemplateCard[],
    githubCredentials: {} as Record<string, { name: string }[]>,
    // A template whose own read fails.
    failing: null as string | null,
  },
  create: vi.fn(),
  navigate: vi.fn(),
  refetchDetail: vi.fn(),
}));

vi.mock('../hooks/queries', () => ({
  useAutomationTemplates: () => ({
    data: { templates: catalog.cards },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAutomationTemplate: (_organizationId: string, slug: string | null) => {
    if (slug !== null && slug === catalog.failing) {
      return {
        data: undefined,
        isError: true,
        error: new Error('The backend is down.'),
        isFetching: false,
        refetch: refetchDetail,
      };
    }
    const card = catalog.cards.find((entry) => entry.slug === slug);
    return {
      data: card === undefined ? undefined : detailOf(card),
      isError: false,
      isFetching: false,
      refetch: refetchDetail,
    };
  },
  useNodeTypeCatalog: () => ({ data: undefined, isError: false }),
}));

vi.mock('../hooks/mutations', () => ({
  useCreateAutomationFromTemplate: () => ({ mutateAsync: create }),
}));

// The canvas itself has its own suites; here the preview only has to put
// the template's document on it.
vi.mock('./template-preview-flow', () => ({
  TemplatePreviewFlow: ({ document }: { document: { nodes: unknown[] } }) => (
    <div data-testid="template-flow">{document.nodes.length} steps</div>
  ),
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => ({
    projects: [
      { _id: 'proj-7', name: 'Billing' },
      { _id: 'proj-8', name: 'Website' },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({
    members: [
      {
        userId: 'usr-ada',
        role: 'member',
        displayName: 'Ada Lovelace',
        email: 'ada@example.com',
      },
    ],
    isLoading: false,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ id: 'org-1' }),
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/shared/zoned-time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shared/zoned-time')>()),
  localTimeZone: () => 'Europe/Zurich',
}));

beforeEach(() => {
  catalog.cards = [REVIEWER, WEBHOOK, SYNC];
  catalog.githubCredentials = { github: [{ name: 'Work' }] };
  catalog.failing = null;
  refetchDetail.mockClear();
  create.mockReset();
  create.mockResolvedValue({
    name: 'tell-the-reviewer',
    version: 1,
    deployed: true,
  });
  navigate.mockClear();
});

function renderCatalog(
  projectId?: string,
  options: {
    onOpenChange?: (open: boolean) => void;
    initialCategory?: 'inbox' | 'issues';
  } = {},
) {
  return render(
    <TemplateCatalogDialog
      organizationId="org-1"
      {...(projectId !== undefined && { projectId })}
      {...(options.initialCategory !== undefined && {
        initialCategory: options.initialCategory,
      })}
      open
      onOpenChange={options.onOpenChange ?? vi.fn()}
    />,
  );
}

/** The dialog's scrolling body. */
function dialogBody(): HTMLElement {
  const body = screen.getByRole('dialog').querySelector('.overflow-y-auto');
  if (!(body instanceof HTMLElement)) throw new Error('no dialog body');
  return body;
}

/** Open a template's preview, then its questions. */
async function useTemplate(
  user: ReturnType<typeof renderCatalog>['user'],
  name: RegExp,
) {
  await user.click(screen.getByRole('button', { name }));
  await user.click(screen.getByRole('button', { name: 'Use this template' }));
}

describe('TemplateCatalogDialog', { timeout: 30_000 }, () => {
  it('lists every template by category, with what it needs and whether it is in use', async () => {
    const { user } = renderCatalog();
    expect(screen.getByRole('dialog', { name: 'Templates' })).toBeVisible();
    // A card per template, the catalog's order: issues before
    // notifications before webhooks.
    const cards = screen
      .getAllByRole('button')
      .filter((button) =>
        /Sync GitHub|Tell the|Create tasks/.test(button.textContent ?? ''),
      );
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('Sync GitHub issues'),
      expect.stringContaining('Tell the reviewer'),
      expect.stringContaining('Create tasks from a webhook'),
    ]);
    expect(
      within(
        screen.getByRole('button', { name: /Sync GitHub issues/ }),
      ).getByText('Connect first'),
    ).toBeVisible();
    expect(
      within(
        screen.getByRole('button', { name: /Create tasks from a webhook/ }),
      ).getByText('In use (2)'),
    ).toBeVisible();

    // A tab per category the catalog holds.
    await user.click(screen.getByRole('tab', { name: 'Webhooks' }));
    expect(
      screen.queryByRole('button', { name: /Tell the reviewer/ }),
    ).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'All' }));

    await user.type(
      screen.getByRole('textbox', { name: 'Search templates' }),
      'github',
    );
    expect(
      screen.getByRole('button', { name: /Sync GitHub issues/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Tell the reviewer/ }),
    ).toBeNull();
  });

  it('previews what a template does, changes and needs, when it runs and its workflow', async () => {
    const { user } = renderCatalog();
    await user.click(
      screen.getByRole('button', { name: /Sync GitHub issues/ }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Sync GitHub issues' });
    expect(within(dialog).getByText('How it works')).toBeVisible();
    expect(
      within(dialog).getByText('Reads the repository’s issues'),
    ).toBeVisible();
    expect(
      within(dialog).getByText('A task for each new issue.'),
    ).toBeVisible();
    expect(within(dialog).getByText('Never writes to GitHub.')).toBeVisible();
    // The schedule runs in the reader's own zone.
    expect(within(dialog).getByText(/Europe\/Zurich/)).toBeVisible();
    // Only what someone has to connect is listed, with the way there.
    expect(within(dialog).getByText('Not connected')).toBeVisible();
    expect(
      within(dialog).getByRole('link', { name: 'Connect' }),
    ).toHaveAttribute('href', '/dashboard/$id/settings/connectors');
    expect(
      await within(dialog).findByTestId('template-flow'),
    ).toHaveTextContent('1 steps');

    // A template it works with opens in its place.
    await user.click(
      within(dialog).getByRole('button', { name: 'Tell the reviewer' }),
    );
    expect(
      screen.getByRole('dialog', { name: 'Tell the reviewer' }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'All templates' }));
    expect(screen.getByRole('dialog', { name: 'Templates' })).toBeVisible();
  });

  it('creates and starts it in one step, in your zone, and opens it in the project it serves', async () => {
    const { user } = renderCatalog('proj-7');
    await useTemplate(user, /Tell the reviewer/);
    // Opened from Billing, the project question starts there.
    expect(screen.getByRole('button', { name: /^Project/ })).toHaveTextContent(
      'Billing',
    );
    await user.click(screen.getByRole('button', { name: /^Reviewer/ }));
    await user.click(screen.getByRole('option', { name: /Ada Lovelace/ }));
    await user.click(screen.getByRole('button', { name: 'Create automation' }));

    expect(create).toHaveBeenCalledWith({
      organizationId: 'org-1',
      slug: 'notify-reviewer',
      name: 'tell-the-reviewer',
      displayName: 'Tell the reviewer',
      answers: {
        project: 'proj-7',
        reviewer: 'usr-ada',
        message: 'This task is ready for your review.',
      },
      locale: 'en',
      timezone: 'Europe/Zurich',
      start: true,
    });
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/projects/$projectId/automations/$automationSlug',
      params: {
        id: 'org-1',
        projectId: 'proj-7',
        automationSlug: 'tell-the-reviewer',
      },
    });
  });

  it('asks every kind of question and sends each answer in its shape, unstarted while a connector is missing', async () => {
    create.mockResolvedValue({
      name: 'sync-github-issues',
      version: 1,
      deployed: false,
    });
    const { user } = renderCatalog();
    await useTemplate(user, /Sync GitHub issues/);
    expect(screen.getByText(/Connect github before it can run/i)).toBeVisible();
    // Its questions can all be answered: it can be created as a draft.
    expect(
      screen.getByText(
        'Connect github first to start it now. You can create it as a draft and start it later.',
      ),
    ).toBeVisible();
    // Nothing can start while GitHub is not connected.
    const startNow = screen.getByRole('checkbox', { name: /Start it now/ });
    expect(startNow).not.toBeChecked();
    expect(startNow).toBeDisabled();

    await user.type(
      screen.getByRole('textbox', { name: /^Repository/ }),
      'tale-project/tale',
    );
    await user.click(
      screen.getByRole('button', { name: 'Increase Issues per run' }),
    );
    await user.click(screen.getByRole('switch', { name: /Closed issues too/ }));
    await user.type(
      screen.getByRole('textbox', { name: /^Labels/ }),
      'bug{Enter}ui',
    );
    // The one credential in service is picked already for a required
    // question; an optional one starts on its empty choice, named for what
    // it means here.
    expect(
      screen.getByRole('combobox', { name: /^Account/ }),
    ).toHaveTextContent('Work');
    expect(
      screen.getByRole('combobox', { name: /^Fallback account/ }),
    ).toHaveTextContent('The default GitHub connection');
    await user.click(screen.getByRole('button', { name: 'Create automation' }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'github/sync-issues',
        start: false,
        answers: {
          repository: 'tale-project/tale',
          batch: 26,
          closed: true,
          labels: ['bug', 'ui'],
          account: 'Work',
          schedule: {
            repeat: { frequency: 'hourly', interval: 1, minute: 0 },
            timezone: 'Europe/Zurich',
            catchUp: 'latest',
          },
        },
      }),
    );
  });

  it('marks each answer the server could not use, and creates nothing', async () => {
    create.mockRejectedValue(
      Object.assign(new Error('refused'), {
        data: {
          code: 'TEMPLATE_ANSWERS_INVALID',
          message: 'Some answers cannot be used.',
          fields: [{ field: 'reviewer', code: 'unknown', message: 'x' }],
        },
      }),
    );
    const { user } = renderCatalog('proj-7');
    await useTemplate(user, /Tell the reviewer/);
    await user.click(screen.getByRole('button', { name: /^Reviewer/ }));
    await user.click(screen.getByRole('option', { name: /Ada Lovelace/ }));
    await user.click(screen.getByRole('button', { name: 'Create automation' }));
    expect(
      await screen.findByText(
        "That person isn't a member of the organization.",
      ),
    ).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows a webhook template its address once, then opens the automation', async () => {
    create.mockResolvedValue({
      name: 'create-tasks-from-a-webhook',
      version: 1,
      deployed: true,
      trigger: { token: 'whk_once', enabled: true },
    });
    const { user } = renderCatalog('proj-7');
    await useTemplate(user, /Create tasks from a webhook/);
    await user.click(screen.getByRole('button', { name: 'Create automation' }));
    expect(
      await screen.findByRole('dialog', { name: 'Your webhook address' }),
    ).toBeVisible();
    expect(
      screen.getByText(/proj-7\/automations\/webhook\/whk_once$/),
    ).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: 'Open the automation' }),
    );
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          automationSlug: 'create-tasks-from-a-webhook',
        }),
      }),
    );
  });

  it('takes a double click or a double Enter on "Use this template" as one: it creates nothing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { user } = renderCatalog('proj-7');
      // Every question of this one is answered already: Create is ready.
      await user.click(
        screen.getByRole('button', { name: /Create tasks from a webhook/ }),
      );
      await user.dblClick(
        screen.getByRole('button', { name: 'Use this template' }),
      );
      const name = screen.getByRole('textbox', { name: /^Name/ });
      expect(name).toHaveFocus();
      // The second click of a double click lands on Create once the
      // questions open: not a create of its own.
      fireEvent.click(
        screen.getByRole('button', { name: 'Create automation' }),
        { detail: 2 },
      );
      // The second press of a double Enter lands in the Name field, where
      // Enter would create it: held while the questions just opened.
      expect(fireEvent.keyDown(name, { key: 'Enter' })).toBe(false);
      expect(create).not.toHaveBeenCalled();

      await user.click(
        screen.getByRole('button', { name: 'Back to the preview' }),
      );
      screen.getByRole('button', { name: 'Use this template' }).focus();
      await user.keyboard('{Enter}{Enter}');
      expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveFocus();
      expect(create).not.toHaveBeenCalled();

      // A moment later, Enter in the field is the reader's own again.
      vi.advanceTimersByTime(1_000);
      expect(
        fireEvent.keyDown(screen.getByRole('textbox', { name: /^Name/ }), {
          key: 'Enter',
        }),
      ).toBe(true);
      await user.click(
        screen.getByRole('button', { name: 'Create automation' }),
      );
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the reader’s place on the way back: tab, search, answers and the card they opened', async () => {
    const { user } = renderCatalog('proj-7');
    await user.click(screen.getByRole('tab', { name: 'Notifications' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Search templates' }),
      'review',
    );
    dialogBody().scrollTop = 300;
    await user.click(screen.getByRole('button', { name: /Tell the reviewer/ }));
    // A step starts at its top, not where the catalog was scrolled to.
    expect(dialogBody().scrollTop).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Use this template' }));
    const name = screen.getByRole('textbox', { name: /^Name/ });
    await user.clear(name);
    await user.type(name, 'Tell Ada');
    await user.click(
      screen.getByRole('button', { name: 'Back to the preview' }),
    );
    await user.click(screen.getByRole('button', { name: 'Use this template' }));
    // The answers outlive a look back at the preview.
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue(
      'Tell Ada',
    );

    await user.click(
      screen.getByRole('button', { name: 'Back to the preview' }),
    );
    dialogBody().scrollTop = 200;
    await user.click(screen.getByRole('button', { name: 'All templates' }));
    expect(dialogBody().scrollTop).toBe(0);
    expect(screen.getByRole('tab', { name: 'Notifications' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      screen.getByRole('textbox', { name: 'Search templates' }),
    ).toHaveValue('review');
    // Focus is back on the card the reader opened, not on the dialog.
    expect(
      screen.getByRole('button', { name: /Tell the reviewer/ }),
    ).toHaveFocus();
  });

  it('opens on the tab a link asks for', () => {
    renderCatalog(undefined, { initialCategory: 'issues' });
    expect(screen.getByRole('tab', { name: 'Issues' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      screen.getByRole('button', { name: /Sync GitHub issues/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Tell the reviewer/ }),
    ).toBeNull();
  });

  it('says why a template could not be read, and tries again', async () => {
    catalog.failing = SYNC.slug;
    const { user } = renderCatalog();
    await user.click(
      screen.getByRole('button', { name: /Sync GitHub issues/ }),
    );
    // In the workflow's place, never a skeleton left loading.
    expect(
      screen.getByText(/Couldn't load the template: The backend is down\./),
    ).toBeVisible();
    expect(screen.queryByTestId('template-flow')).toBeNull();
    const use = screen.getByRole('button', { name: 'Use this template' });
    expect(use).toHaveAttribute('aria-disabled', 'true');
    act(() => use.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      "Couldn't load the template: The backend is down.",
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetchDetail).toHaveBeenCalled();
  });

  it('asks for a connection first when a question needs one of its credentials, never offering a draft', async () => {
    catalog.githubCredentials = {};
    const { user } = renderCatalog();
    await useTemplate(user, /Sync GitHub issues/);
    expect(
      screen.getByText('Connect github before you create it.'),
    ).toBeVisible();
    // No draft is possible: the hint does not offer one.
    expect(screen.queryByText(/create it as a draft/)).toBeNull();
    const createButton = screen.getByRole('button', {
      name: 'Create automation',
    });
    expect(createButton).toHaveAttribute('aria-disabled', 'true');
    act(() => createButton.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Connect github before you create it.',
    );
  });

  it('shows a number typed out of range as typed, and holds the create until it is fixed', async () => {
    const { user } = renderCatalog();
    await useTemplate(user, /Sync GitHub issues/);
    await user.type(
      screen.getByRole('textbox', { name: /^Repository/ }),
      'tale-project/tale',
    );
    const batch = screen.getByRole('spinbutton', { name: /^Issues per run/ });
    await user.clear(batch);
    await user.type(batch, '150');
    await user.tab();
    // Never corrected behind the reader's back.
    expect(batch).toHaveValue('150');
    expect(batch).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText('Give a whole number from 1 to 100.'),
    ).toBeVisible();
    const createButton = screen.getByRole('button', {
      name: 'Create automation',
    });
    expect(createButton).toHaveAttribute('aria-disabled', 'true');
    act(() => createButton.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      '"Issues per run" takes a whole number from 1 to 100.',
    );
    await user.click(createButton);
    expect(create).not.toHaveBeenCalled();

    await user.clear(batch);
    await user.type(batch, '40');
    expect(screen.queryByText('Give a whole number from 1 to 100.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create automation' }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        answers: expect.objectContaining({ batch: 40 }),
      }),
    );
  });

  it('stays open while it creates, so the address it answers is never lost', async () => {
    let finish: (created: unknown) => void = () => undefined;
    create.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const onOpenChange = vi.fn();
    const { user } = renderCatalog('proj-7', { onOpenChange });
    await useTemplate(user, /Create tasks from a webhook/);
    await user.click(screen.getByRole('button', { name: 'Create automation' }));
    // No way to close it mid-create: no Close, and Escape is held.
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await act(async () => {
      finish({
        name: 'create-tasks-from-a-webhook',
        version: 1,
        deployed: true,
        trigger: { token: 'whk_once', enabled: true },
      });
    });
    expect(
      await screen.findByRole('dialog', { name: 'Your webhook address' }),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close' })).toBeVisible(),
    );
  });

  it('points a template that connects nothing of its own to the ones it works with', async () => {
    const SUMMARY: TemplateCard = {
      ...REVIEWER,
      slug: 'inbox-summary',
      name: 'Summarize the inbox',
      category: 'inbox',
      worksWith: ['github/sync-issues'],
    };
    catalog.cards = [SUMMARY, SYNC];
    const { user } = renderCatalog();
    await user.click(
      screen.getByRole('button', { name: /Summarize the inbox/ }),
    );
    expect(
      screen.getByText(
        'Nothing to connect here: it works on what one of the templates under Works with brings in.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/it works with what Tale already has/),
    ).toBeNull();
  });

  it('passes an axe audit on the catalog, a preview and its questions', async () => {
    const { container, user } = renderCatalog();
    await checkAccessibility(container);
    await user.click(
      screen.getByRole('button', { name: /Sync GitHub issues/ }),
    );
    await screen.findByTestId('template-flow');
    await checkAccessibility(container);
    await user.click(screen.getByRole('button', { name: 'Use this template' }));
    await checkAccessibility(container);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import type { StarterCard } from '../lib/starters';
import { StarterGalleryDialog } from './starter-gallery-dialog';

const REVIEWER: StarterCard = {
  slug: 'notify-reviewer',
  name: 'Tell the reviewer',
  description: 'Tells a member when a task of a project moves to In review.',
  icon: 'bell-ring',
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
    { slug: 'task', connected: true },
    { slug: 'notify', connected: true },
  ],
  trigger: { kind: 'event', event: 'task.status_changed' },
  steps: [
    { id: 'task', type: 'task.get' },
    { id: 'notify', type: 'notify.member' },
  ],
};

const WEBHOOK: StarterCard = {
  slug: 'webhook-create-task',
  name: 'Create tasks from a webhook',
  description: 'Creates a task for each delivery.',
  icon: 'webhook',
  details: 'Another system sends JSON to the webhook address.',
  i18n: {},
  scope: 'project',
  fields: [{ id: 'project', kind: 'project', label: 'Project' }],
  connectors: [{ slug: 'task', connected: true }],
  trigger: { kind: 'webhook' },
  steps: [{ id: 'create', type: 'task.create' }],
};

const INBOX: StarterCard = {
  slug: 'inbox-summary',
  name: 'Summarise the inbox',
  description: 'Sends a member a summary of the inbox.',
  icon: 'inbox',
  details: 'On the schedule you set, the inbox is summarised.',
  i18n: {},
  scope: 'org',
  fields: [
    {
      id: 'mailbox',
      kind: 'choice',
      label: 'Mailbox',
      default: 'gmail',
      options: [
        { value: 'gmail', label: 'Gmail' },
        { value: 'outlook', label: 'Outlook' },
      ],
    },
    { id: 'recipient', kind: 'member', label: 'Send to' },
    { id: 'schedule', kind: 'schedule', label: 'When' },
  ],
  connectors: [
    { slug: 'conversation', connected: true },
    { slug: 'gmail', connected: false },
  ],
  trigger: {
    kind: 'schedule',
    repeat: {
      frequency: 'weekly',
      interval: 1,
      weekdays: [1, 2, 3, 4, 5],
      times: ['08:00'],
    },
    timezone: 'UTC',
  },
  steps: [
    { id: 'inbox', type: 'conversation.list_untriaged' },
    { id: 'summary', type: 'llm' },
  ],
};

const { templates, create, deploy, navigate } = vi.hoisted(() => ({
  templates: { cards: [] as StarterCard[] },
  create: vi.fn(),
  deploy: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('../hooks/queries', () => ({
  useAutomationTemplates: () => ({
    data: { templates: templates.cards },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useNodeTypeCatalog: () => ({ data: undefined, isError: false }),
}));

vi.mock('../hooks/mutations', () => ({
  useCreateAutomationFromTemplate: () => ({ mutateAsync: create }),
  useDeployAutomation: () => ({ mutateAsync: deploy }),
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
      {
        userId: 'usr-gone',
        role: 'disabled',
        displayName: 'Former colleague',
        email: 'gone@example.com',
      },
    ],
    isLoading: false,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ id: 'org-1' }),
}));

vi.mock('@/lib/shared/zoned-time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shared/zoned-time')>()),
  localTimeZone: () => 'Europe/Zurich',
}));

beforeEach(() => {
  templates.cards = [REVIEWER, WEBHOOK, INBOX];
  create.mockReset();
  create.mockResolvedValue({ name: 'tell-the-reviewer', version: 1 });
  deploy.mockReset();
  deploy.mockResolvedValue({ name: 'tell-the-reviewer', version: 1 });
  navigate.mockClear();
});

function renderGallery(projectId?: string) {
  return render(
    <StarterGalleryDialog
      organizationId="org-1"
      {...(projectId !== undefined && { projectId })}
      open
      onOpenChange={vi.fn()}
    />,
  );
}

/** Answer the reviewer starter's member question with Ada. */
async function pickAda(user: ReturnType<typeof renderGallery>['user']) {
  await user.click(screen.getByRole('button', { name: /^Reviewer/ }));
  await user.click(screen.getByRole('option', { name: /Ada Lovelace/ }));
}

describe('StarterGalleryDialog', { timeout: 30_000 }, () => {
  it('lists every starter and narrows them as you search', async () => {
    const { user } = renderGallery();
    expect(
      screen.getByRole('button', { name: /Tell the reviewer/ }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: /Create tasks from a webhook/ }),
    ).toBeVisible();
    // A starter whose connector is not set up says so on its row.
    expect(
      within(
        screen.getByRole('button', { name: /Summarise the inbox/ }),
      ).getByText('Needs a connection'),
    ).toBeVisible();

    await user.type(
      screen.getByRole('textbox', { name: 'Search starters' }),
      'webhook',
    );
    expect(
      screen.queryByRole('button', { name: /Tell the reviewer/ }),
    ).toBeNull();
    await user.clear(screen.getByRole('textbox', { name: 'Search starters' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Search starters' }),
      'nothing like it',
    );
    expect(screen.getByText('No starter matches your search.')).toBeVisible();
  });

  it('opens a starter on its questions, how it works, and its name to change', async () => {
    const { user } = renderGallery();
    await user.click(screen.getByRole('button', { name: /Tell the reviewer/ }));
    expect(
      screen.getByRole('dialog', { name: 'Tell the reviewer' }),
    ).toBeVisible();
    expect(screen.getByText(/the member you choose is told/)).toBeVisible();
    expect(screen.getByText('How it works')).toBeVisible();
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Tell the reviewer');
    expect(screen.getByLabelText(/^Message/)).toHaveValue(
      'This task is ready for your review.',
    );
    // Nobody is picked yet, so Create waits — focusable, saying why.
    expect(
      screen.getByRole('button', { name: 'Create automation' }),
    ).toHaveAttribute('aria-disabled', 'true');

    await user.click(screen.getByRole('button', { name: 'All starters' }));
    expect(
      screen.getByRole('dialog', { name: 'Choose a starter' }),
    ).toBeVisible();
  });

  it('creates it with the answers, starts it, and opens it in the project it serves', async () => {
    const { user } = renderGallery('proj-7');
    await user.click(screen.getByRole('button', { name: /Tell the reviewer/ }));
    // Opened from Billing, the project question starts there.
    expect(screen.getByRole('button', { name: /^Project/ })).toHaveTextContent(
      'Billing',
    );
    // A disabled member is nobody to tell.
    await user.click(screen.getByRole('button', { name: /^Reviewer/ }));
    expect(
      screen.queryByRole('option', { name: /Former colleague/ }),
    ).toBeNull();
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
      enableTrigger: true,
    });
    expect(deploy).toHaveBeenCalledWith({
      organizationId: 'org-1',
      name: 'tell-the-reviewer',
      version: 1,
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

  it('creates a draft with its trigger off when it is not started now', async () => {
    const { user } = renderGallery();
    await user.click(screen.getByRole('button', { name: /Tell the reviewer/ }));
    await user.click(screen.getByRole('button', { name: /^Project/ }));
    await user.click(screen.getByRole('option', { name: 'Website' }));
    await pickAda(user);
    await user.click(screen.getByRole('checkbox', { name: /Start it now/ }));
    await user.click(screen.getByRole('button', { name: 'Create automation' }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ enableTrigger: false }),
    );
    expect(deploy).not.toHaveBeenCalled();
    // Created from the organization's list, it opens there.
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/automations/$automationSlug',
      params: { id: 'org-1', automationSlug: 'tell-the-reviewer' },
    });
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
    const { user } = renderGallery('proj-7');
    await user.click(screen.getByRole('button', { name: /Tell the reviewer/ }));
    await pickAda(user);
    await user.click(screen.getByRole('button', { name: 'Create automation' }));
    expect(
      await screen.findByText(
        "That person isn't a member of the organization.",
      ),
    ).toBeVisible();
    expect(deploy).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('asks for another name when an automation has this one', async () => {
    create.mockRejectedValue(
      Object.assign(new Error('taken'), {
        data: { code: 'AUTOMATION_NAME_TAKEN', message: 'taken' },
      }),
    );
    const { user } = renderGallery('proj-7');
    await user.click(screen.getByRole('button', { name: /Tell the reviewer/ }));
    await pickAda(user);
    await user.click(screen.getByRole('button', { name: 'Create automation' }));
    expect(
      await screen.findByText('An automation with that name already exists.'),
    ).toBeVisible();
  });

  it('shows a webhook starter its address once, then opens the automation', async () => {
    create.mockResolvedValue({
      name: 'create-tasks-from-a-webhook',
      version: 1,
      trigger: { token: 'whk_once' },
    });
    const { user } = renderGallery('proj-7');
    await user.click(
      screen.getByRole('button', { name: /Create tasks from a webhook/ }),
    );
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

  it('sends a scheduled starter its schedule in your zone and its choice', async () => {
    create.mockResolvedValue({ name: 'summarise-the-inbox', version: 1 });
    const { user } = renderGallery();
    await user.click(
      screen.getByRole('button', { name: /Summarise the inbox/ }),
    );
    expect(screen.getByText(/Connect gmail before it can run/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: /^Send to/ }));
    await user.click(screen.getByRole('option', { name: /Ada Lovelace/ }));
    await user.click(screen.getByRole('button', { name: 'Create automation' }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'inbox-summary',
        answers: {
          mailbox: 'gmail',
          recipient: 'usr-ada',
          schedule: {
            repeat: {
              frequency: 'weekly',
              interval: 1,
              weekdays: [1, 2, 3, 4, 5],
              times: ['08:00'],
            },
            timezone: 'Europe/Zurich',
            catchUp: 'latest',
          },
        },
      }),
    );
  });

  it('passes an axe audit on the gallery and on a starter', async () => {
    const { container, user } = renderGallery();
    await checkAccessibility(container);
    await user.click(screen.getByRole('button', { name: /Tell the reviewer/ }));
    await checkAccessibility(container);
  });
});

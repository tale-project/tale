import type { ProjectDispatch } from '@tale/shared/schemas/project-dispatch';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/tests/utils/i18n-all-languages';
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

import {
  ProjectDispatchEditor,
  type ProjectDispatchEditorProps,
} from './project-dispatch-editor';

// The Dispatch editor against a closed synthetic transport: the real form,
// its checks, the configuration read and the save run; the project's agents,
// labels and tasks are stand-ins. Every name is synthetic.

configure({ asyncUtilTimeout: 10_000 });

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock('@tale/ui/use-toast', () => ({
  toast,
  useToast: () => ({ toast, toasts: [], dismiss: vi.fn() }),
}));

// The dialog's error boundary reads the org id from the route.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useParams: () => ({ id: 'org-1' }),
}));

vi.mock('../hooks/queries', () => ({
  useProjectAgents: () => ({
    agents: [
      { _id: 'agent-scribe', name: 'Scribe' },
      { _id: 'agent-lector', name: 'Lector' },
    ],
  }),
}));

vi.mock('@/app/features/tasks/hooks/queries', () => ({
  useTaskLabels: () => ({
    labels: [
      { _id: 'label-release', name: 'release' },
      { _id: 'label-ci', name: 'ci' },
    ],
    isLoading: false,
  }),
  useTasksByProject: () => ({
    tasks: [{ _id: 'task-routing', title: 'Route reviews', number: 7 }],
  }),
}));

const CONFIG =
  /^GET \/api\/app\/tasks\/dispatch\/by-project\/proj-1\/configuration\?orgId=org-1$/;
const SAVE =
  /^POST \/api\/app\/tasks\/dispatch\/by-project\/proj-1\/configuration\?orgId=org-1$/;
const STATUS =
  /^GET \/api\/app\/tasks\/dispatch\/by-project\/proj-1\?orgId=org-1$/;

const HASH = 'a'.repeat(64);
const NEXT_HASH = 'b'.repeat(64);

const SPARSE: ProjectDispatch = {
  enabled: true,
  agents: ['agent-scribe'],
  maxConcurrentRuns: 2,
  statuses: ['todo'],
  assignment: 'assigned',
};

const WITH_ROLE_AND_GATE: ProjectDispatch = {
  ...SPARSE,
  labels: { include: ['release'] },
  standingRoles: [
    {
      key: 'manager',
      taskId: 'task-routing',
      agentId: 'agent-scribe',
      cron: '0,30 * * * *',
      timezone: 'Europe/Zurich',
    },
  ],
  gates: [{ key: 'ci', labels: ['ci'], holdAt: 20 }],
};

const t = (key: string, values?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'projects', ...values });
const tCommon = (key: string) => i18n.t(key, { ns: 'common' });

let backend: SyntheticBackend;
let client: QueryClient;
let saved: unknown[];

beforeEach(() => {
  window.history.replaceState(
    {},
    '',
    '/dashboard/org-1/projects/proj-1/dispatch',
  );
  backend = syntheticBackend();
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
  saved = [];
  toast.mockReset();
  // A save refreshes the page's readback; it is not this suite's subject.
  backend.on(STATUS, () => Response.json({}));
});

afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
});

function stored(dispatch: ProjectDispatch | null, hash: string | null = HASH) {
  backend.on(CONFIG, () =>
    Response.json({
      config: dispatch === null ? null : { ...dispatch, projectId: 'proj-1' },
      hash: dispatch === null ? null : hash,
    }),
  );
}

function saves(answer: () => Response) {
  backend.on(SAVE, (_url, init) => {
    saved.push(typeof init?.body === 'string' ? JSON.parse(init.body) : null);
    return answer();
  });
}

function renderEditor(props: Partial<ProjectDispatchEditorProps> = {}) {
  const onOpenChange = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <ProjectDispatchEditor
        open
        onOpenChange={onOpenChange}
        organizationId="org-1"
        projectId="proj-1"
        projectKey="TAL"
        workersLimit={3}
        taskTitles={new Map()}
        settingUp={false}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...view, onOpenChange };
}

async function editorDialog(title: string) {
  return within(await screen.findByRole('dialog', { name: title }));
}

describe('setting up a project’s dispatch', () => {
  it('starts from the defaults and saves only what a dispatch must declare', async () => {
    stored(null);
    saves(() => Response.json({ ok: true, changed: true, hash: HASH }));
    const { user, onOpenChange } = renderEditor({ settingUp: true });
    const dialog = await editorDialog(t('dispatch.editor.setUpTitle'));

    expect(
      await dialog.findByRole('switch', { name: t('dispatch.editor.enabled') }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      dialog.getByLabelText(t('dispatch.editor.maxConcurrentRuns')),
    ).toHaveValue(3);
    expect(
      dialog.getByLabelText(t('dispatch.editor.perAgentConcurrency')),
    ).toHaveValue(1);
    expect(
      dialog.getByLabelText(t('dispatch.editor.startSpacing')),
    ).toHaveValue(30);
    expect(dialog.getByLabelText(t('dispatch.editor.recheck'))).toHaveValue(
      '60, 120, 240',
    );

    await user.click(
      dialog.getByRole('combobox', { name: t('dispatch.editor.agents') }),
    );
    await user.click(await screen.findByRole('option', { name: 'Scribe' }));
    await user.keyboard('{Escape}');
    await user.click(
      dialog.getByRole('button', { name: tCommon('actions.save') }),
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(saved).toEqual([
      {
        config: {
          enabled: true,
          agents: ['agent-scribe'],
          maxConcurrentRuns: 3,
          statuses: ['todo'],
          assignment: 'assigned',
          projectId: 'proj-1',
        },
        expectedHash: null,
      },
    ]);
    expect(toast).toHaveBeenCalledWith({
      title: t('dispatch.editor.saved'),
      variant: 'success',
    });
  });
});

describe('editing a project’s dispatch', () => {
  it('saves over the version it read, and keeps out what the stored dispatch left out', async () => {
    stored(SPARSE);
    saves(() => Response.json({ ok: true, changed: true, hash: NEXT_HASH }));
    const { user, onOpenChange } = renderEditor();
    const dialog = await editorDialog(t('dispatch.editor.title'));
    const runs = await dialog.findByLabelText(
      t('dispatch.editor.maxConcurrentRuns'),
    );
    await user.clear(runs);
    await user.type(runs, '5');
    await user.click(
      dialog.getByRole('button', { name: tCommon('actions.save') }),
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(saved).toEqual([
      {
        config: { ...SPARSE, maxConcurrentRuns: 5, projectId: 'proj-1' },
        expectedHash: HASH,
      },
    ]);
  });

  it('opens a dispatch saved with one agent above the pool, and saves it once it fits', async () => {
    // Saved before a write had to keep runs per agent within the pool.
    stored({ ...SPARSE, maxConcurrentRuns: 2, perAgentConcurrency: 5 });
    saves(() => Response.json({ ok: true, changed: true, hash: NEXT_HASH }));
    const { user, onOpenChange } = renderEditor();
    const dialog = await editorDialog(t('dispatch.editor.title'));
    const perAgent = await dialog.findByLabelText(
      t('dispatch.editor.perAgentConcurrency'),
    );
    expect(perAgent).toHaveValue(5);
    const runs = dialog.getByLabelText(t('dispatch.editor.maxConcurrentRuns'));
    await user.clear(runs);
    await user.type(runs, '3');
    await user.click(
      dialog.getByRole('button', { name: tCommon('actions.save') }),
    );
    expect(
      await dialog.findByText(
        t('dispatch.editor.validation.perAgentAboveRuns'),
      ),
    ).toBeInTheDocument();
    expect(saved).toEqual([]);

    await user.clear(perAgent);
    await user.type(perAgent, '3');
    await user.click(
      dialog.getByRole('button', { name: tCommon('actions.save') }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(saved).toEqual([
      {
        config: {
          ...SPARSE,
          maxConcurrentRuns: 3,
          perAgentConcurrency: 3,
          projectId: 'proj-1',
        },
        expectedHash: HASH,
      },
    ]);
  });

  it('checks the form before it saves anything', async () => {
    stored(SPARSE);
    saves(() => Response.json({ ok: true, changed: true, hash: NEXT_HASH }));
    const { user } = renderEditor();
    const dialog = await editorDialog(t('dispatch.editor.title'));
    const runs = await dialog.findByLabelText(
      t('dispatch.editor.maxConcurrentRuns'),
    );
    await user.clear(runs);
    await user.type(runs, '0');
    await user.click(
      dialog.getByRole('button', { name: t('dispatch.editor.roles.add') }),
    );
    await user.type(
      dialog.getByLabelText(t('dispatch.editor.roles.key')),
      'Manager',
    );
    await user.type(
      dialog.getByLabelText(t('dispatch.editor.roles.cron')),
      '61 * * * *',
    );
    await user.click(
      dialog.getByRole('button', { name: tCommon('actions.save') }),
    );

    expect(
      await dialog.findByText(
        t('dispatch.editor.validation.wholeNumber', { min: 1, max: 500 }),
      ),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(t('dispatch.editor.validation.key')),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(t('dispatch.editor.validation.roleAgent')),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(t('dispatch.editor.validation.roleTask')),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(
        new RegExp(
          `^${t('dispatch.editor.validation.cronInvalid', { reason: '' })}`,
        ),
      ),
    ).toBeInTheDocument();
    expect(backend.count(SAVE)).toBe(0);
    expect(toast).not.toHaveBeenCalled();
  });

  it('shows what the platform refused under the fields it names, and keeps the draft open', async () => {
    stored(WITH_ROLE_AND_GATE);
    saves(() =>
      Response.json(
        {
          error: 'DISPATCH_INVALID',
          message:
            'The dispatch names an agent, a task, a label or a schedule this project cannot use; the issues say which.',
          data: {
            issues: [
              {
                path: 'labels.include.0',
                message: 'No label named "release" is in this project.',
              },
              {
                path: 'standingRoles.0.taskId',
                message:
                  'The standing role’s task is archived; restore it first.',
              },
              {
                path: 'gates.0.labels.0',
                message: 'No label named "ci" is in this project.',
              },
              { path: 'statuses', message: 'Something else.' },
            ],
          },
        },
        { status: 400 },
      ),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user, onOpenChange } = renderEditor();
    const dialog = await editorDialog(t('dispatch.editor.title'));
    const runs = await dialog.findByLabelText(
      t('dispatch.editor.maxConcurrentRuns'),
    );
    await user.clear(runs);
    await user.type(runs, '3');
    await user.click(
      dialog.getByRole('button', { name: tCommon('actions.save') }),
    );

    expect(
      await dialog.findByText(
        t('dispatch.editor.issues.label', { name: 'release' }),
      ),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(t('dispatch.editor.issues.label', { name: 'ci' })),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(t('dispatch.editor.issues.roleTask')),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(t('dispatch.editor.issues.refusedTitle')),
    ).toBeInTheDocument();
    expect(dialog.getByText('statuses: Something else.')).toBeInTheDocument();
    // The label's issue is read with the control it belongs to.
    const include = dialog.getByRole('combobox', {
      name: t('dispatch.editor.labelsInclude'),
    });
    expect(include).toHaveAccessibleDescription(
      t('dispatch.editor.issues.label', { name: 'release' }),
    );
    expect(saved).toHaveLength(1);
    expect(toast).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('never saves over another session’s save, and offers that version instead', async () => {
    stored(SPARSE);
    saves(() =>
      Response.json(
        {
          error: 'CONFIG_VERSION_CONFLICT',
          message:
            'Configuration changed since it was reviewed. Read the current value and plan again.',
        },
        { status: 409 },
      ),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user, onOpenChange } = renderEditor();
    const dialog = await editorDialog(t('dispatch.editor.title'));
    const runs = await dialog.findByLabelText(
      t('dispatch.editor.maxConcurrentRuns'),
    );
    await user.clear(runs);
    await user.type(runs, '5');
    // Another session saved meanwhile.
    stored({ ...SPARSE, maxConcurrentRuns: 7 }, NEXT_HASH);
    await user.click(
      dialog.getByRole('button', { name: tCommon('actions.save') }),
    );

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: tCommon('actions.save'),
        description: t('dispatch.editor.conflict'),
        variant: 'destructive',
      }),
    );
    expect(toast).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(saved).toEqual([
      {
        config: { ...SPARSE, maxConcurrentRuns: 5, projectId: 'proj-1' },
        expectedHash: HASH,
      },
    ]);

    expect(
      await dialog.findByText(t('dispatch.editor.changedTitle')),
    ).toBeInTheDocument();
    await user.click(
      dialog.getByRole('button', { name: t('dispatch.editor.reload') }),
    );
    expect(
      dialog.getByLabelText(t('dispatch.editor.maxConcurrentRuns')),
    ).toHaveValue(7);
    expect(
      dialog.queryByText(t('dispatch.editor.changedTitle')),
    ).not.toBeInTheDocument();
  });

  it('never offers a dispatch a newer version saved for editing', async () => {
    backend.on(CONFIG, () =>
      Response.json(
        {
          error: 'CONFIG_UNREADABLE',
          message:
            'The project’s stored dispatch cannot be read by this version of Tale, and is kept as it is.',
        },
        { status: 409 },
      ),
    );
    const { user, onOpenChange } = renderEditor();
    const dialog = await editorDialog(t('dispatch.editor.title'));
    expect(
      await dialog.findByText(t('dispatch.unreadable.title')),
    ).toBeInTheDocument();
    expect(dialog.getByText(t('dispatch.unreadable.body'))).toBeInTheDocument();
    expect(
      dialog.queryByRole('button', { name: tCommon('actions.save') }),
    ).not.toBeInTheDocument();
    expect(
      dialog.queryByLabelText(t('dispatch.editor.maxConcurrentRuns')),
    ).not.toBeInTheDocument();
    // The footer's Close, beside the header's own.
    const closes = dialog.getAllByRole('button', {
      name: tCommon('actions.close'),
    });
    expect(closes).toHaveLength(2);
    await user.click(closes[closes.length - 1]!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(backend.count(SAVE)).toBe(0);
  });

  it('reads the stored version again at every opening, whatever the app’s stale window', async () => {
    // The app keeps a read fresh for five minutes; the editor may not.
    client = new QueryClient({
      defaultOptions: {
        queries: { retryDelay: 0, gcTime: Infinity, staleTime: 5 * 60_000 },
      },
    });
    stored(SPARSE);
    const first = renderEditor();
    expect(
      await (
        await editorDialog(t('dispatch.editor.title'))
      ).findByLabelText(t('dispatch.editor.maxConcurrentRuns')),
    ).toHaveValue(2);
    first.unmount();

    stored({ ...SPARSE, maxConcurrentRuns: 6 }, NEXT_HASH);
    renderEditor();
    expect(
      await (
        await editorDialog(t('dispatch.editor.title'))
      ).findByLabelText(t('dispatch.editor.maxConcurrentRuns')),
    ).toHaveValue(6);
    expect(backend.count(CONFIG)).toBe(2);
  });

  it('names a read that failed, and reads it again', async () => {
    backend.on(CONFIG, () => serviceUnavailable());
    const { user } = renderEditor();
    const dialog = await editorDialog(t('dispatch.editor.title'));
    expect(
      await dialog.findByText(t('dispatch.editor.loadFailed')),
    ).toBeInTheDocument();
    stored(SPARSE);
    await user.click(
      dialog.getByRole('button', { name: tCommon('actions.tryAgain') }),
    );
    expect(
      await dialog.findByLabelText(t('dispatch.editor.maxConcurrentRuns')),
    ).toHaveValue(2);
  });
});

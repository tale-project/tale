import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { configure, render, screen, waitFor } from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { TaskDetailPage } from './task-detail-page';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #4587: a task page whose read failed for a reason other than the task
// being gone said **Page not found**, with no way to read it again. The read
// runs for real here (`useTask`, the adapter row, `backendFetch`, the
// four-attempt retry policy) against a closed synthetic transport.

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
}));
// The body is the board dialog's own, tested with it; here it only has to
// show whether the page mounted it.
vi.mock('./task-modal', () => ({
  EditTaskBody: () => <div data-testid="task-body" />,
}));

const TASK = /^GET \/api\/app\/tasks\/t1\?orgId=org-1$/;
const LAUNCH = {
  task: {
    id: 't1',
    organizationId: 'org-1',
    projectId: 'p1',
    title: 'Review the launch checklist',
    status: 'todo',
    labels: [],
    labelIds: [],
    commentCount: 0,
    rank: 'a',
    createdAt: 1000,
  },
  canEdit: true,
  canCreate: true,
  canComment: true,
};

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
  backend = syntheticBackend();
  // No backoff between the policy's attempts; the attempt count is real.
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
  delete window.__ENV__;
});

function renderPage() {
  return render(
    <QueryClientProvider client={client}>
      <TaskDetailPage organizationId="org-1" taskId="t1" />
    </QueryClientProvider>,
  );
}

const t = (key: string) => i18n.t(key, { ns: 'tasks' });
const pageNotFound = () => i18n.t('notFound.title', { ns: 'common' });
const tryAgain = () =>
  screen.getByRole('button', {
    name: i18n.t('actions.tryAgain', { ns: 'common' }),
  });

describe('TaskDetailPage when the task read fails', { timeout: 30_000 }, () => {
  it('says the task could not load, with Try again, never Page not found', async () => {
    backend.on(TASK, () => serviceUnavailable());
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('detail.loadFailed'));
    // The policy's four attempts settled it, as a failure.
    expect(backend.count(TASK)).toBe(4);
    expect(tryAgain()).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: pageNotFound() }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-body')).not.toBeInTheDocument();
  });

  it('keeps the failure on screen while Try again runs, then loads the task into the page', async () => {
    backend.on(TASK, () => serviceUnavailable());
    const { user } = renderPage();
    await screen.findByRole('alert');

    // A retry that is still on its way: react-query has reset the read to
    // pending, but the page goes on saying it failed — no skeleton, no
    // dead end — with Try again busy where the focus left it.
    let answer: (response: Response) => void = () => {};
    backend.on(
      TASK,
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    await user.click(tryAgain());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(t('read.retrying')),
    );
    expect(tryAgain()).toHaveAttribute('aria-busy', 'true');
    expect(tryAgain()).toHaveFocus();
    expect(screen.queryByTestId('task-body')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: pageNotFound() }),
    ).not.toBeInTheDocument();

    answer(Response.json(LAUNCH));
    expect(await screen.findByTestId('task-body')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // The focus that pressed Try again lands on the task it brought back.
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Review the launch checklist' }),
      ).toHaveFocus(),
    );
  });

  it('says it failed again when Try again fails, its button keeping the focus', async () => {
    backend.on(TASK, () => serviceUnavailable());
    const { user } = renderPage();
    await screen.findByRole('alert');

    await user.click(tryAgain());
    await waitFor(() => expect(backend.count(TASK)).toBe(8));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        t('detail.loadFailed'),
      ),
    );
    expect(tryAgain()).not.toHaveAttribute('aria-busy');
    expect(tryAgain()).toHaveFocus();
  });

  // The controls: a read that answered that the task is gone is not a
  // failure, and keeps the platform's dead end, without a retry.
  it('keeps the dead end for a task the read answered as gone', async () => {
    backend.on(TASK, () =>
      Response.json(
        { error: 'TASK_NOT_FOUND', message: 'Task not found' },
        { status: 404 },
      ),
    );
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: pageNotFound() }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(backend.count(TASK)).toBe(1);
  });

  it('keeps the dead end for a task that is not this member’s to see', async () => {
    backend.on(TASK, () =>
      Response.json(
        { error: 'TASK_FORBIDDEN', message: 'No project access' },
        { status: 403 },
      ),
    );
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: pageNotFound() }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // A refusal is an answer: the policy does not ask again.
    expect(backend.count(TASK)).toBe(1);
  });
});

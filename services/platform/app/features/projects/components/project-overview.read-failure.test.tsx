import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { configure, render, screen, waitFor } from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { ProjectOverview } from './project-overview';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #3885: a project read that failed left the Overview blank — no section, no
// alert, no way to try again — the same as a project that was never there.
// The read runs for real here (`useProject`, the adapter row, `backendFetch`,
// the four-attempt retry policy) against a closed synthetic transport.

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));
// The sections with reads of their own are not the subject.
vi.mock('./project-sharing-section', () => ({
  ProjectSharingSection: () => null,
}));
vi.mock('./project-task-reviewer-section', () => ({
  ProjectTaskReviewerSection: () => null,
}));
vi.mock('./project-archive-section', () => ({
  ProjectArchiveSection: () => null,
}));
vi.mock('./project-danger-zone', () => ({
  ProjectDangerZone: () => null,
}));

const PROJECT = /^GET \/api\/app\/projects\/proj-1\?orgId=org-1$/;
const APOLLO = {
  id: 'proj-1',
  organizationId: 'org-1',
  name: 'Apollo',
  description: null,
  icon: null,
  color: null,
  key: 'APO',
  externalItemId: null,
  taskCounter: 0,
  openTaskCount: 0,
  doneTaskCount: 0,
  projectAgentCount: 0,
  teamId: null,
  sharedWithTeamIds: [],
  teamIds: [],
  instructions: null,
  createdBy: 'u1',
  createdAt: 1000,
  updatedAt: 2000,
  archivedAt: null,
  pinnedAt: null,
  isOrgWide: true,
  canEdit: true,
  canAdminister: false,
};

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
  backend = syntheticBackend();
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
  delete window.__ENV__;
});

function renderOverview() {
  return render(
    <QueryClientProvider client={client}>
      <ProjectOverview organizationId="org-1" projectId="proj-1" />
    </QueryClientProvider>,
  );
}

const t = (key: string) => i18n.t(key, { ns: 'projects' });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const nameField = () => screen.queryByRole('textbox', { name: 'Name' });

describe(
  'ProjectOverview when the project read fails',
  { timeout: 30_000 },
  () => {
    it('says the project could not load, with Try again, never a blank page', async () => {
      backend.on(PROJECT, () => serviceUnavailable());
      renderOverview();

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(t('loadFailed'));
      expect(backend.count(PROJECT)).toBe(4);
      expect(
        screen.getByRole('button', { name: tryAgain() }),
      ).toBeInTheDocument();
      // Not passed off as a project that is gone, nor as an empty form.
      expect(
        screen.queryByText(t('errors.PROJECT_NOT_FOUND')),
      ).not.toBeInTheDocument();
      expect(nameField()).not.toBeInTheDocument();
    });

    it('loads the project into the page when Try again works', async () => {
      backend.on(PROJECT, () => serviceUnavailable());
      const { user } = renderOverview();
      await screen.findByRole('alert');

      backend.on(PROJECT, () => Response.json({ project: APOLLO }));
      await user.click(screen.getByRole('button', { name: tryAgain() }));

      await waitFor(() => expect(nameField()).toHaveValue('Apollo'));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    // The controls: an answered read is not a failure.
    it('says a project the read answered as gone is gone, without an error or a retry', async () => {
      backend.on(PROJECT, () =>
        Response.json(
          { error: 'PROJECT_NOT_FOUND', code: 'PROJECT_NOT_FOUND' },
          { status: 404 },
        ),
      );
      renderOverview();

      expect(
        await screen.findByText(t('errors.PROJECT_NOT_FOUND')),
      ).toBeInTheDocument();
      expect(backend.count(PROJECT)).toBe(1);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: tryAgain() }),
      ).not.toBeInTheDocument();
    });

    it('shows the project when the read answers', async () => {
      backend.on(PROJECT, () => Response.json({ project: APOLLO }));
      renderOverview();

      await waitFor(() => expect(nameField()).toHaveValue('Apollo'));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(t('loadFailed'))).not.toBeInTheDocument();
    });
  },
);

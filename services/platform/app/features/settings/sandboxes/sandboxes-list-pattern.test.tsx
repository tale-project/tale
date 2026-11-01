import { DEFAULT_LIST_PAGE_SIZE } from '@tale/ui/list-page-size';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  SandboxDevicesView,
  SandboxDeviceView,
} from '@/lib/shared/schemas/sandbox-devices';
import { render, screen } from '@/tests/utils/render';

import { SandboxesSettings } from './sandboxes-settings';

const { state, query, refetchSessions, refetchDevices } = vi.hoisted(() => ({
  state: {
    canManage: true,
    sessions: [] as unknown[],
    devices: [] as SandboxDeviceView[],
    hub: 'available' as SandboxDevicesView['hub'],
    failed: null as 'sessions' | 'devices' | null,
  },
  query: vi.fn(),
  refetchSessions: vi.fn(),
  refetchDevices: vi.fn(),
}));

// A task a workspace works on opens it; no router runs here.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <a href="#task" title={title}>
      {children}
    </a>
  ),
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: (action: string) => action === 'read' || state.canManage,
  }),
  useAbilityLoading: () => false,
}));
vi.mock('@/app/hooks/use-backend-query', () => ({ useBackendQuery: query }));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@tale/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
// The page's other sections and the connect dialog have tests of their own;
// here the dialog only says whether Add device opened it.
vi.mock('./sandbox-quota-editor', () => ({ SandboxQuotaEditor: () => null }));
vi.mock('./sandbox-capacity', () => ({ SandboxCapacitySection: () => null }));
vi.mock('./workspace-cleanup-editor', () => ({
  WorkspaceCleanupEditor: () => null,
}));
vi.mock('./add-device-dialog', () => ({
  AddDeviceDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Add device dialog" /> : null,
}));

/** More rows than one display window holds. */
const MANY = DEFAULT_LIST_PAGE_SIZE + 5;
const AT = 1_750_000_000_000;

/** A read as `useBackendQuery` answers it: loaded, or with its last
 * refresh failed and the rows it loaded before still there. */
function read(data: unknown, refetch: () => void, failed: boolean) {
  return {
    data,
    error: failed ? new Error('read failed') : null,
    isLoading: false,
    isFetching: false,
    isError: failed,
    refetch,
    errorUpdateCount: failed ? 1 : 0,
  };
}

/** Agent `i`'s workspace, working on task WEB-`i`. */
function workspace(i: number) {
  return {
    sessionId: `session-${i}`,
    ownerType: 'project_agent',
    ownerId: `agent-${i}`,
    ownerLabel: `Agent ${i}`,
    createdBy: 'system:task-agent',
    ownerName: null,
    ownerEmail: null,
    agentKind: 'claude-code',
    status: 'active',
    createdAt: AT,
    pinned: false,
    busy: true,
    totalSpentCents: 0,
    currentOp: null,
    runningOps: [
      {
        kind: 'task-agent',
        execId: `exec-${i}`,
        taskId: `task-${i}`,
        task: {
          id: `task-${i}`,
          projectId: 'project-1',
          key: `WEB-${i}`,
          title: `Release ${i}`,
        },
        status: 'running',
        startedAt: AT,
      },
    ],
  };
}

function workspaces(count: number) {
  return Array.from({ length: count }, (_, i) => workspace(i));
}

/** The idle workspace of an agent deleted since: listed as a deleted
 * agent's, not by its id. */
const orphanWorkspace = {
  ...workspace(99),
  sessionId: 'session-orphan',
  ownerLabel: null,
  busy: false,
  runningOps: [],
};

function device(i: number): SandboxDeviceView {
  return {
    id: `device-${i}`,
    name: `Device ${i}`,
    status: 'online',
    createdAt: AT,
    createdBy: 'admin-1',
    lastSeenAt: AT,
    connectedAt: AT,
    version: '0.5.60',
    maxSessions: 4,
    platform: { os: 'linux', arch: 'x64' },
    sessions: { running: 0, starting: 0 },
    resources: null,
    update: null,
  };
}

function devices(count: number) {
  return Array.from({ length: count }, (_, i) => device(i));
}

/**
 * DataTable's own root: it holds the table's toolbar and the bordered frame
 * whose scrollport holds the table. `overflow-x-auto` is the scrollport of the
 * non-sticky layout a scrolling settings page needs (#2381, #2436); a sticky
 * table has none, and fails here.
 */
function tableRoot(table: HTMLElement): HTMLElement {
  const root = table.closest('.overflow-x-auto')?.parentElement?.parentElement;
  if (!root) throw new Error('No non-sticky DataTable frame around the table');
  return root;
}

/**
 * Each control sits in the table's own toolbar: inside the DataTable, above
 * the table and never in it. A button in the section's header fails the
 * first check.
 */
function expectInToolbar(table: HTMLElement, controls: HTMLElement[]) {
  const root = tableRoot(table);
  for (const control of controls) {
    expect(root).toContainElement(control);
    expect(table).not.toContainElement(control);
    expect(
      table.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  }
}

/** The one Add device button, which is DataTable's `addAction`. */
function addDeviceButton(): HTMLElement {
  const buttons = screen.getAllByRole('button', { name: 'Add device' });
  expect(buttons).toHaveLength(1);
  const button = buttons[0] as HTMLElement;
  expect(button.closest('[data-table-add-action]')).not.toBeNull();
  return button;
}

beforeEach(() => {
  state.canManage = true;
  state.sessions = [];
  state.devices = [];
  state.hub = 'available';
  state.failed = null;
  refetchSessions.mockReset();
  refetchDevices.mockReset();
  query.mockReset().mockImplementation((name: string) => {
    if (name.endsWith(':listSandboxesForOrg')) {
      return read(
        { sessions: state.sessions },
        refetchSessions,
        state.failed === 'sessions',
      );
    }
    if (name === 'sandbox_devices/queries:list') {
      return read(
        { devices: state.devices, hub: state.hub, serverVersion: '0.5.60' },
        refetchDevices,
        state.failed === 'devices',
      );
    }
    return read(undefined, vi.fn(), false);
  });
});

describe('Sandboxes tables follow the settings list pattern', () => {
  describe('Workspaces', () => {
    it('shows one window of workspaces under a search in the table toolbar', () => {
      state.sessions = workspaces(MANY);
      render(<SandboxesSettings organizationId="org-1" />);

      expectInToolbar(screen.getByRole('table', { name: 'Sandboxes' }), [
        screen.getByPlaceholderText('Search workspaces'),
      ]);
      expect(screen.getAllByText(/^Agent \d+$/)).toHaveLength(
        DEFAULT_LIST_PAGE_SIZE,
      );
      expect(
        screen.getByText(
          `Showing ${DEFAULT_LIST_PAGE_SIZE} of ${MANY} workspaces`,
        ),
      ).toBeInTheDocument();
    });

    it('names a short list whole', () => {
      state.sessions = workspaces(3);
      render(<SandboxesSettings organizationId="org-1" />);

      expect(screen.getByText('Showing all 3 workspaces')).toBeInTheDocument();
    });

    it.each([
      ['the task working in it', 'WEB-7', 'Agent 7'],
      ['its owner as the table names it', 'deleted', 'Deleted agent'],
    ])('finds a workspace by %s', async (_, searchText, owner) => {
      state.sessions = [...workspaces(MANY), orphanWorkspace];
      const { user } = render(<SandboxesSettings organizationId="org-1" />);

      await user.type(
        screen.getByPlaceholderText('Search workspaces'),
        searchText,
      );

      expect(
        await screen.findByText(`Showing 1 of ${MANY + 1} workspaces`),
      ).toBeInTheDocument();
      expect(screen.getByText(owner)).toBeInTheDocument();
      expect(screen.queryAllByText(/^Agent \d+$/)).toHaveLength(
        owner === 'Deleted agent' ? 0 : 1,
      );
    });

    it('keeps the workspaces through a failed refresh and names it above them', async () => {
      state.sessions = workspaces(3);
      state.failed = 'sessions';
      const { user } = render(<SandboxesSettings organizationId="org-1" />);

      const table = screen.getByRole('table', { name: 'Sandboxes' });
      expect(screen.getAllByText(/^Agent \d+$/)).toHaveLength(3);
      const notice = screen.getByText(
        'Something went wrong while loading this page. Try again or go to another section.',
      );
      expect(tableRoot(table)).not.toContainElement(notice);
      expect(
        table.compareDocumentPosition(notice) &
          Node.DOCUMENT_POSITION_PRECEDING,
      ).toBeTruthy();

      await user.click(screen.getByRole('button', { name: 'Try again' }));

      expect(refetchSessions).toHaveBeenCalledTimes(1);
      expect(refetchDevices).not.toHaveBeenCalled();
    });
  });

  describe('Devices', () => {
    it('shows one window of devices and closes on the count footer', () => {
      state.devices = devices(MANY);
      render(<SandboxesSettings organizationId="org-1" />);

      expect(screen.getAllByText(/^Device \d+$/)).toHaveLength(
        DEFAULT_LIST_PAGE_SIZE,
      );
      expect(
        screen.getByText(
          `Showing ${DEFAULT_LIST_PAGE_SIZE} of ${MANY} devices`,
        ),
      ).toBeInTheDocument();
    });

    it.each([
      ['with devices', 2],
      ['when empty', 0],
    ])(
      'keeps search and Add device in the table toolbar %s',
      async (_, count) => {
        state.devices = devices(count);
        const { user } = render(<SandboxesSettings organizationId="org-1" />);

        const add = addDeviceButton();
        expectInToolbar(screen.getByRole('table', { name: 'Devices' }), [
          screen.getByPlaceholderText('Search devices'),
          add,
        ]);
        expect(
          screen.queryByRole('dialog', { name: 'Add device dialog' }),
        ).toBeNull();

        await user.click(add);

        expect(
          screen.getByRole('dialog', { name: 'Add device dialog' }),
        ).toBeInTheDocument();
      },
    );

    it('finds a device by its system as the table names it', async () => {
      state.devices = [
        ...devices(MANY),
        { ...device(MANY), platform: { os: 'darwin', arch: 'arm64' } },
      ];
      const { user } = render(<SandboxesSettings organizationId="org-1" />);

      await user.type(screen.getByPlaceholderText('Search devices'), 'macos');

      expect(
        await screen.findByText(`Showing 1 of ${MANY + 1} devices`),
      ).toBeInTheDocument();
      expect(screen.getAllByText(/^Device \d+$/)).toHaveLength(1);
      expect(screen.getByText(`Device ${MANY}`)).toBeInTheDocument();
    });

    it('keeps Add device in the toolbar but disabled while the hub is not configured', () => {
      state.devices = devices(1);
      state.hub = 'not_configured';
      render(<SandboxesSettings organizationId="org-1" />);

      const table = screen.getByRole('table', { name: 'Devices' });
      const add = addDeviceButton();
      expectInToolbar(table, [add]);
      expect(add).toBeDisabled();
      // The hub's notice stays above the table, outside its toolbar.
      const notice = screen.getByText(
        "This deployment's sandbox service doesn't accept devices. Ask your operator to turn on the device hub.",
      );
      expect(tableRoot(table)).not.toContainElement(notice);
      expect(
        table.compareDocumentPosition(notice) &
          Node.DOCUMENT_POSITION_PRECEDING,
      ).toBeTruthy();
    });

    it('lists devices to developers under a search, without Add device', () => {
      state.canManage = false;
      state.devices = devices(2);
      render(<SandboxesSettings organizationId="org-1" />);

      expectInToolbar(screen.getByRole('table', { name: 'Devices' }), [
        screen.getByPlaceholderText('Search devices'),
      ]);
      expect(screen.queryByRole('button', { name: 'Add device' })).toBeNull();
      expect(screen.getByText('Showing all 2 devices')).toBeInTheDocument();
    });

    it('keeps the devices through a failed refresh and names it above them', async () => {
      state.devices = devices(2);
      state.failed = 'devices';
      const { user } = render(<SandboxesSettings organizationId="org-1" />);

      const table = screen.getByRole('table', { name: 'Devices' });
      expect(screen.getAllByText(/^Device \d+$/)).toHaveLength(2);
      const notice = screen.getByText(
        'Something went wrong while loading this page. Try again or go to another section.',
      );
      expect(tableRoot(table)).not.toContainElement(notice);

      await user.click(screen.getByRole('button', { name: 'Try again' }));

      expect(refetchDevices).toHaveBeenCalledTimes(1);
      expect(refetchSessions).not.toHaveBeenCalled();
    });
  });
});

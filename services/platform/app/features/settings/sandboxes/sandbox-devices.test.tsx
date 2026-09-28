import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  SandboxDevicesView,
  SandboxDeviceView,
} from '@/lib/shared/schemas/sandbox-devices';
import {
  SESSION_ENDED,
  lapsedSessionRefusal,
} from '@/tests/utils/lapsed-session';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { SandboxDevicesSection } from './sandbox-devices';

const { mintToken, removeDevice, toast } = vi.hoisted(() => ({
  mintToken: vi.fn(),
  removeDevice: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: (name: string) => ({
    mutateAsync:
      name === 'sandbox_devices/mutations:createJoinToken'
        ? mintToken
        : removeDevice,
    isPending: false,
  }),
}));
vi.mock('@tale/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

function device(overrides: Partial<SandboxDeviceView> = {}): SandboxDeviceView {
  return {
    id: 'dev-1',
    name: 'studio-mac',
    status: 'online',
    createdAt: 1_790_000_000_000,
    createdBy: 'admin-1',
    lastSeenAt: 1_790_000_060_000,
    connectedAt: 1_790_000_000_000,
    version: '0.5.60',
    maxSessions: 4,
    platform: {
      os: 'darwin',
      arch: 'arm64',
      cpus: 10,
      memoryBytes: 32 * 1024 ** 3,
      dockerVersion: '27.1.1',
    },
    sessions: { running: 1, starting: 0 },
    resources: null,
    update: null,
    ...overrides,
  };
}

function view(
  devices: SandboxDeviceView[],
  hub: SandboxDevicesView['hub'] = 'available',
): SandboxDevicesView {
  return { devices, hub, serverVersion: '0.5.60' };
}

function renderSection(props: {
  view?: SandboxDevicesView;
  canManage?: boolean;
  onRefresh?: () => void;
}) {
  return render(
    <SandboxDevicesSection
      organizationId="org-1"
      view={props.view ?? view([])}
      isLoading={false}
      error={null}
      canManage={props.canManage ?? true}
      onRefresh={props.onRefresh ?? vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mintToken.mockResolvedValue({
    token: 'tsdj_1234abcd',
    expiresAt: 1_790_003_600_000,
    serverUrl: 'https://acme.tale.dev',
  });
  removeDevice.mockResolvedValue(null);
});

describe('SandboxDevicesSection', () => {
  it('lists each device with its state, machine and load', () => {
    renderSection({
      view: view([
        device(),
        device({
          id: 'dev-2',
          name: 'build-box',
          status: 'updating',
          platform: {
            os: 'linux',
            arch: 'x64',
            cpus: 1,
            memoryBytes: 8 * 1024 ** 3,
          },
          update: {
            state: 'updating',
            targetVersion: '0.5.61',
            error: null,
            atMs: 1,
          },
        }),
        device({
          id: 'dev-3',
          name: 'old-laptop',
          status: 'offline',
          sessions: null,
        }),
      ]),
    });
    const table = screen.getByRole('table', { name: 'Devices' });
    const mac = within(table)
      .getByText('studio-mac')
      .closest('tr') as HTMLElement;
    expect(within(mac).getByText('macOS · arm64')).toBeInTheDocument();
    expect(within(mac).getByText('Online')).toBeInTheDocument();
    expect(within(mac).getByText('1 / 4')).toBeInTheDocument();
    expect(within(mac).getByText('10 CPUs · 32 GiB')).toBeInTheDocument();
    const box = within(table)
      .getByText('build-box')
      .closest('tr') as HTMLElement;
    expect(within(box).getByText('Updating')).toBeInTheDocument();
    expect(within(box).getByText('Updating to 0.5.61')).toBeInTheDocument();
    expect(within(box).getByText('1 CPU · 8 GiB')).toBeInTheDocument();
    const laptop = within(table)
      .getByText('old-laptop')
      .closest('tr') as HTMLElement;
    expect(within(laptop).getByText('Offline')).toBeInTheDocument();
    expect(within(laptop).getByText('— / 4')).toBeInTheDocument();
  });

  it('shows why an update failed, not only in a tooltip', () => {
    renderSection({
      view: view([
        device({
          status: 'update_failed',
          update: {
            state: 'failed',
            targetVersion: '0.5.61',
            error: 'pull access denied for tale-sandbox:0.5.61',
            atMs: 1,
          },
        }),
      ]),
    });
    const row = within(screen.getByRole('table', { name: 'Devices' }))
      .getByText('studio-mac')
      .closest('tr') as HTMLElement;
    expect(within(row).getByText('Update failed')).toBeInTheDocument();
    expect(
      within(row).getByText('pull access denied for tale-sandbox:0.5.61'),
    ).toBeVisible();
  });

  it('explains an empty list', () => {
    renderSection({});
    expect(screen.getByText('No devices yet')).toBeInTheDocument();
  });

  it('only admins add or remove devices', () => {
    renderSection({ view: view([device()]), canManage: false });
    expect(
      screen.queryByRole('button', { name: 'Add device' }),
    ).not.toBeInTheDocument();
    const headers = within(screen.getByRole('table', { name: 'Devices' }))
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers).toEqual([
      'Device',
      'Status',
      'Sandboxes',
      'Machine',
      'Version',
      'Last seen',
    ]);
  });

  it('says so, and offers no command, when the deployment accepts no devices', () => {
    renderSection({ view: view([], 'not_configured') });
    expect(screen.getByText(/doesn't accept devices/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add device' })).toBeDisabled();
  });

  it('removes a device after confirmation', async () => {
    const { user } = renderSection({ view: view([device()]) });
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove studio-mac?',
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Remove device' }),
    );
    await waitFor(() =>
      expect(removeDevice).toHaveBeenCalledWith({
        organizationId: 'org-1',
        deviceId: 'dev-1',
      }),
    );
    expect(toast).toHaveBeenCalledWith({ title: 'Device removed' });
  });

  // The refusal's own `message` is its serialized payload; the toast used
  // to read `{"code":"UNAUTHORIZED",…}` under its title.
  it('says the session ended when the removal is refused', async () => {
    removeDevice.mockImplementation(() => lapsedSessionRefusal());
    const { user } = renderSection({ view: view([device()]) });
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove studio-mac?',
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Remove device' }),
    );

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: "Couldn't remove the device",
        description: SESSION_ENDED.en,
        variant: 'destructive',
      }),
    );
  });
});

describe('Add device', () => {
  it('mints one command per opening and hands out the one-liner', async () => {
    const { user } = renderSection({});
    await user.click(screen.getByRole('button', { name: 'Add device' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a device' });
    await waitFor(() =>
      expect(within(dialog).getAllByText(/tsdj_1234abcd/).length).toBe(2),
    );
    expect(mintToken).toHaveBeenCalledTimes(1);
    expect(mintToken).toHaveBeenCalledWith({ organizationId: 'org-1' });
    expect(dialog.textContent).toContain(
      'curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | VERSION=0.5.60 bash && tale sandbox connect https://acme.tale.dev --token tsdj_1234abcd',
    );
    expect(
      within(dialog).getByText('Waiting for the device to connect…'),
    ).toBeInTheDocument();
  });

  it('copies the one-liner with a visible button once the command exists', async () => {
    let finishMint: (value: unknown) => void = () => {};
    mintToken.mockReturnValueOnce(
      new Promise((resolve) => {
        finishMint = resolve;
      }),
    );
    const { user } = renderSection({});
    // user-event installs its clipboard stub at render.
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: 'Add device' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a device' });
    // The stand-in command shown while minting is never copyable.
    expect(
      within(dialog).queryByRole('button', { name: 'Copy command' }),
    ).toBeNull();
    finishMint({
      token: 'tsdj_1234abcd',
      expiresAt: 1_790_003_600_000,
      serverUrl: 'https://acme.tale.dev',
    });
    const copy = await within(dialog).findByRole('button', {
      name: 'Copy command',
    });
    expect(copy).toBeEnabled();
    await user.click(copy);
    expect(writeText).toHaveBeenCalledWith(
      'curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | VERSION=0.5.60 bash && tale sandbox connect https://acme.tale.dev --token tsdj_1234abcd',
    );
    expect(
      await within(dialog).findByRole('button', { name: 'Copied' }),
    ).toBeInTheDocument();
  });

  it('confirms the machine that connected while the dialog was open', async () => {
    const devices: SandboxDeviceView[] = [device()];
    const { user, rerender } = renderSection({ view: view(devices) });
    await user.click(screen.getByRole('button', { name: 'Add device' }));
    await screen.findAllByText(/tsdj_1234abcd/);
    rerender(
      <SandboxDevicesSection
        organizationId="org-1"
        view={view([...devices, device({ id: 'dev-new', name: 'new-box' })])}
        isLoading={false}
        error={null}
        canManage
        onRefresh={vi.fn()}
      />,
    );
    expect(
      await screen.findByText('new-box is connected.'),
    ).toBeInTheDocument();
  });

  it('a machine that joined but is still starting is not yet connected', async () => {
    const { user, rerender } = renderSection({ view: view([]) });
    await user.click(screen.getByRole('button', { name: 'Add device' }));
    await screen.findAllByText(/tsdj_1234abcd/);
    const show = (status: SandboxDeviceView['status']) =>
      rerender(
        <SandboxDevicesSection
          organizationId="org-1"
          view={view([device({ id: 'dev-new', name: 'new-box', status })])}
          isLoading={false}
          error={null}
          canManage
          onRefresh={vi.fn()}
        />,
      );
    // The join made the row; the first start is still pulling images.
    show('offline');
    expect(
      screen.getByText('Waiting for the device to connect…'),
    ).toBeInTheDocument();
    expect(screen.queryByText('new-box is connected.')).toBeNull();
    show('online');
    expect(
      await screen.findByText('new-box is connected.'),
    ).toBeInTheDocument();
  });

  it('keeps a failed mint repairable in place', async () => {
    mintToken.mockRejectedValueOnce(new Error('boom'));
    const { user } = renderSection({});
    await user.click(screen.getByRole('button', { name: 'Add device' }));
    expect(
      await screen.findByText("Couldn't create a connect command."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findAllByText(/tsdj_1234abcd/)).length).toBe(2);
    expect(mintToken).toHaveBeenCalledTimes(2);
  });
});

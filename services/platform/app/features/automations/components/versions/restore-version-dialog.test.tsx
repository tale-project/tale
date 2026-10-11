// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { toast } from '@tale/ui/use-toast';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { RestoreVersionDialog } from './restore-version-dialog';

const mutateAsync = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('../../hooks/mutations', () => ({
  useRestoreAutomationVersion: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}));
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({
    members: [{ userId: 'user-ada', displayName: 'Ada Lovelace' }],
  }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-me' } }),
}));

const deploy = vi.fn();
const onClose = vi.fn();

function renderDialog(
  props: Partial<Parameters<typeof RestoreVersionDialog>[0]> = {},
) {
  return render(
    <RestoreVersionDialog
      organizationId="org-1"
      automationSlug="ops/digest"
      version={2}
      latestVersion={5}
      liveVersion={4}
      canDeploy
      deployer={{ deploy }}
      onClose={onClose}
      {...props}
    />,
  );
}

type ToastCall = {
  title?: string;
  variant?: string;
  action?: ReactElement<{ onClick: () => void }>;
};

function toastCall(): ToastCall {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mock records what the dialog handed `toast`
  return vi.mocked(toast).mock.calls[0]?.[0] as ToastCall;
}

beforeEach(() => {
  mutateAsync.mockReset();
  navigate.mockReset();
  deploy.mockReset();
  onClose.mockReset();
  vi.mocked(toast).mockClear();
});

describe('RestoreVersionDialog', () => {
  it('says what the restore saves and what stays, with the message prefilled', async () => {
    const { baseElement } = renderDialog();
    expect(
      screen.getByRole('heading', { name: 'Restore v2 as a new version?' }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Tale saves a copy of v2 as v6. v3 to v5 stay in the history. The live version doesn't change.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText('Version message')).toHaveValue('Restore v2');
    await checkAccessibility(baseElement);
  });

  it('restores on top of the latest it shows, and opens the new version from the toast', async () => {
    mutateAsync.mockResolvedValueOnce({
      name: 'ops/digest',
      version: 6,
      restoredFrom: 2,
    });
    const { user } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(mutateAsync).toHaveBeenCalledWith({
      organizationId: 'org-1',
      name: 'ops/digest',
      version: 2,
      message: 'Restore v2',
      baseVersion: 5,
    });
    expect(onClose).toHaveBeenCalled();
    expect(toastCall()).toMatchObject({
      title: 'v6 saved from v2.',
      variant: 'success',
    });
    toastCall().action?.props.onClick();
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: { version: 6 } }),
    );
    expect(deploy).not.toHaveBeenCalled();
  });

  it('puts the restored version live right away when asked', async () => {
    mutateAsync.mockResolvedValueOnce({
      name: 'ops/digest',
      version: 6,
      restoredFrom: 2,
    });
    const { user } = renderDialog();
    await user.click(
      screen.getByRole('checkbox', { name: 'Make v6 live right away' }),
    );
    // The live version changes now, so the dialog no longer says it won't.
    expect(screen.queryByText(/The live version doesn't change/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(deploy).toHaveBeenCalledWith(6, 4);
  });

  it('says when the latest version already matches, saving nothing', async () => {
    mutateAsync.mockResolvedValueOnce({
      name: 'ops/digest',
      version: 5,
      restoredFrom: 2,
      unchanged: true,
    });
    const { user } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(toastCall().title).toBe('v5 already matches v2. Nothing was saved.');
  });

  it('asks again on top of a version saved meanwhile, naming who saved it', async () => {
    mutateAsync.mockRejectedValueOnce({
      data: {
        code: 'AUTOMATION_VERSION_STALE',
        latestVersion: 6,
        latestCreatedBy: 'user-ada',
        latestCreatedAt: 1_791_000_000_000,
        latestVia: 'app',
      },
    });
    const { user } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(
      screen.getByText(
        'Ada Lovelace saved v6 while this was open. Restore on top of v6?',
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Tale saves a copy of v2 as v7. v3 to v6 stay in the history. The live version doesn't change.",
      ),
    ).toBeVisible();
    mutateAsync.mockResolvedValueOnce({
      name: 'ops/digest',
      version: 7,
      restoredFrom: 2,
    });
    await user.click(
      screen.getByRole('button', { name: 'Restore on top of v6' }),
    );
    expect(mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseVersion: 6 }),
    );
  });

  it('lists what a version no longer passes and offers the editor instead', async () => {
    mutateAsync.mockRejectedValueOnce({
      data: {
        code: 'AUTOMATION_INVALID',
        errors: [
          { level: 'error', code: 'NODE_UNKNOWN_TYPE', message: 'unknown' },
        ],
      },
    });
    const { user } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(
      screen.getByText(
        "v2 doesn't pass today's checks, so it can't be restored as it is. Open it, fix what's listed and save a new version.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Open v2 in the editor' }),
    );
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: { version: 2 } }),
    );
  });

  it('renders nothing while closed', () => {
    renderDialog({ version: null });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

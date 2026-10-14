import { sandboxWorkspacesConfigSchema } from '@tale/shared/schemas/governance';
import {
  ActiveEditorProvider,
  EditorActions,
  EditorGroup,
  useActiveEditor,
} from '@tale/ui/editor';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';
import { render, screen, waitFor } from '@/tests/utils/render';

import { WorkspaceCleanupEditor } from './workspace-cleanup-editor';

type PolicyRead = {
  isLoading: boolean;
  isError: boolean;
  data: null | undefined | { key: string; config: unknown };
};

const { state, query, save, toast } = vi.hoisted(() => ({
  state: {
    policy: { isLoading: false, isError: false, data: null } as PolicyRead,
  },
  query: vi.fn(),
  save: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-backend-query', () => ({ useBackendQuery: query }));
vi.mock('@tale/ui/use-toast', () => ({ toast }));
vi.mock('../governance/hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: save }),
}));

const INVALID_DAYS = 'Must be a whole number between 1 and 3650.';
const INVALID_SIZE = 'Must be a whole number between 1 and 10240.';
const INVALID_HOURS = 'Must be a whole number between 1 and 8760.';
/** The disk and size rules every saved policy carries unless changed. */
const UNCAPPED = { reclaimOnDiskPressure: true, reclaimMinIdleHours: 24 };

function HeaderActions() {
  const editor = useActiveEditor();
  return editor ? <EditorActions controller={editor} /> : null;
}

function EditorView() {
  return (
    <ActiveEditorProvider>
      <HeaderActions />
      <EditorGroup>
        <WorkspaceCleanupEditor organizationId="org-1" />
      </EditorGroup>
    </ActiveEditorProvider>
  );
}

function deleteSwitch() {
  return screen.getByRole('switch', { name: 'Delete unused workspaces' });
}

function daysInput() {
  return screen.getByRole('spinbutton', { name: 'Days without use' });
}

beforeEach(() => {
  state.policy = { isLoading: false, isError: false, data: null };
  query.mockReset().mockImplementation(() => state.policy);
  save.mockReset().mockResolvedValue(null);
  toast.mockReset();
});

describe('WorkspaceCleanupEditor', () => {
  it('shows the defaults the cleanup applies while the organization has no policy file', () => {
    render(<EditorView />);
    expect(query).toHaveBeenCalledWith('governance/queries:getPolicy', {
      organizationId: 'org-1',
      policyType: 'sandbox_workspaces',
    });
    expect(
      screen.getByRole('heading', { name: 'Workspace cleanup' }),
    ).toBeInTheDocument();
    expect(deleteSwitch()).toBeChecked();
    expect(daysInput()).toHaveValue(30);
    expect(daysInput()).toBeEnabled();
    // The field's own description says how the days count, including the
    // full period a new or shorter window grants before any deletion.
    expect(daysInput()).toHaveAccessibleDescription(
      'Counted from the last time the agent worked in the workspace. After you turn deletion on or shorten the period, no workspace is deleted until the full number of days has passed.',
    );
  });

  it('shows the saved policy, its days disabled while deletion is off', () => {
    state.policy.data = {
      key: 'sandbox_workspaces',
      config: { deleteUnused: false, unusedDays: 90 },
    };
    render(<EditorView />);
    expect(deleteSwitch()).not.toBeChecked();
    expect(daysInput()).toHaveValue(90);
    expect(daysInput()).toBeDisabled();
  });

  it('saves a new window through the grouped Save', async () => {
    const { user } = render(<EditorView />);
    await user.clear(daysInput());
    await user.type(daysInput(), '45');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        organizationId: 'org-1',
        policyType: 'sandbox_workspaces',
        config: { deleteUnused: true, unusedDays: 45, ...UNCAPPED },
      }),
    );
  });

  it('disables the days when deletion is turned off and keeps them in the saved policy', async () => {
    const { user } = render(<EditorView />);
    await user.click(deleteSwitch());
    expect(deleteSwitch()).not.toBeChecked();
    expect(daysInput()).toBeDisabled();
    expect(daysInput()).toHaveValue(30);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        organizationId: 'org-1',
        policyType: 'sandbox_workspaces',
        config: { deleteUnused: false, unusedDays: 30, ...UNCAPPED },
      }),
    );
  });

  it.each(['0', '3651', '2.5', ''])(
    'rejects %j days with the localized message',
    async (value) => {
      const { user } = render(<EditorView />);
      await user.clear(daysInput());
      if (value) await user.type(daysInput(), value);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(),
      );
      await user.tab();
      expect(await screen.findByText(INVALID_DAYS)).toBeInTheDocument();
      expect(daysInput()).toHaveAttribute('aria-invalid', 'true');
      expect(save).not.toHaveBeenCalled();
    },
  );

  it.each([1, 3650, 0, 3651])(
    'accepts %i days exactly when the policy schema does',
    async (days) => {
      const accepted =
        sandboxWorkspacesConfigSchema.shape.unusedDays.safeParse(days).success;
      const { user } = render(<EditorView />);
      await user.clear(daysInput());
      await user.type(daysInput(), String(days));
      await user.tab();
      if (accepted) {
        expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
        expect(screen.queryByText(INVALID_DAYS)).not.toBeInTheDocument();
      } else {
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
        expect(await screen.findByText(INVALID_DAYS)).toBeInTheDocument();
      }
    },
  );

  it('returns an invalid days entry to its saved value when deletion is turned off', async () => {
    // Off disables the days field; an error left in it would hold Save back
    // from a field nobody can edit any more.
    const { user } = render(<EditorView />);
    await user.clear(daysInput());
    await user.type(daysInput(), '0');
    await user.tab();
    expect(await screen.findByText(INVALID_DAYS)).toBeInTheDocument();
    await user.click(deleteSwitch());
    expect(daysInput()).toHaveValue(30);
    expect(screen.queryByText(INVALID_DAYS)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          config: { deleteUnused: false, unusedDays: 30, ...UNCAPPED },
        }),
      ),
    );
  });

  it('reports a failed save once, in its own words, and keeps the edit', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    save.mockRejectedValueOnce(
      new AppError({
        code: 'validation',
        message: 'Invalid sandbox_workspaces configuration',
      }),
    );
    const { user } = render(<EditorView />);
    await user.clear(daysInput());
    await user.type(daysInput(), '60');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Couldn't save the workspace cleanup settings",
          variant: 'destructive',
        }),
      ),
    );
    expect(toast).toHaveBeenCalledOnce();
    expect(JSON.stringify(toast.mock.calls)).not.toContain('"code"');
    expect(daysInput()).toHaveValue(60);
    consoleError.mockRestore();
  });

  it('never offers defaults to save when the policy cannot be read', () => {
    state.policy = { isLoading: false, isError: true, data: undefined };
    render(<EditorView />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load the workspace cleanup settings. Reload the page to try again.",
    );
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
  });

  it('offers no Save while the policy is still loading', () => {
    state.policy = { isLoading: true, isError: false, data: undefined };
    render(<EditorView />);
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
  });
});

describe('WorkspaceCleanupEditor — disk space and size', () => {
  function diskSwitch() {
    return screen.getByRole('switch', {
      name: 'Free disk space when it runs short',
    });
  }
  function capSwitch() {
    return screen.getByRole('switch', { name: 'Limit workspace size' });
  }
  function sizeInput() {
    return screen.getByRole('spinbutton', { name: 'Maximum size (GiB)' });
  }
  function hoursInput() {
    return screen.getByRole('spinbutton', {
      name: 'Minimum hours without use',
    });
  }

  it('shows the rules in force without a policy file: disk space freed when it runs short, no cap, 24 idle hours', () => {
    render(<EditorView />);
    expect(diskSwitch()).toBeChecked();
    expect(capSwitch()).not.toBeChecked();
    expect(sizeInput()).toBeDisabled();
    expect(sizeInput()).toHaveValue(50);
    expect(hoursInput()).toBeEnabled();
    expect(hoursInput()).toHaveValue(24);
    expect(hoursInput()).toHaveAccessibleDescription(
      'Tale deletes a workspace to free disk space or for its size only once nobody has used it for at least this many hours. Pinned workspaces and workspaces under a legal hold are always kept.',
    );
  });

  it('saves a size cap through the grouped Save', async () => {
    const { user } = render(<EditorView />);
    await user.click(capSwitch());
    expect(sizeInput()).toBeEnabled();
    await user.clear(sizeInput());
    await user.type(sizeInput(), '30');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        organizationId: 'org-1',
        policyType: 'sandbox_workspaces',
        config: {
          deleteUnused: true,
          unusedDays: 30,
          ...UNCAPPED,
          maxWorkspaceGiB: 30,
        },
      }),
    );
  });

  it('shows a saved cap, and leaves it out of the policy once switched off', async () => {
    state.policy.data = {
      key: 'sandbox_workspaces',
      config: {
        deleteUnused: true,
        unusedDays: 30,
        maxWorkspaceGiB: 40,
        reclaimMinIdleHours: 6,
      },
    };
    const { user } = render(<EditorView />);
    expect(capSwitch()).toBeChecked();
    expect(sizeInput()).toHaveValue(40);
    expect(hoursInput()).toHaveValue(6);
    await user.click(capSwitch());
    expect(sizeInput()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          config: {
            deleteUnused: true,
            unusedDays: 30,
            reclaimOnDiskPressure: true,
            reclaimMinIdleHours: 6,
          },
        }),
      ),
    );
  });

  it('disables the idle hours while neither rule uses them', async () => {
    const { user } = render(<EditorView />);
    await user.click(diskSwitch());
    expect(diskSwitch()).not.toBeChecked();
    expect(hoursInput()).toBeDisabled();
    await user.click(capSwitch());
    expect(hoursInput()).toBeEnabled();
  });

  it.each([1, 10_240, 0, 10_241])(
    'accepts a %i GiB cap exactly when the policy schema does',
    async (gib) => {
      const accepted =
        sandboxWorkspacesConfigSchema.shape.maxWorkspaceGiB.safeParse(
          gib,
        ).success;
      const { user } = render(<EditorView />);
      await user.click(capSwitch());
      await user.clear(sizeInput());
      await user.type(sizeInput(), String(gib));
      await user.tab();
      if (accepted) {
        expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
        expect(screen.queryByText(INVALID_SIZE)).not.toBeInTheDocument();
      } else {
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
        expect(await screen.findByText(INVALID_SIZE)).toBeInTheDocument();
      }
    },
  );

  it.each([1, 8760, 0, 8761])(
    'accepts %i idle hours exactly when the policy schema does',
    async (hours) => {
      const accepted =
        sandboxWorkspacesConfigSchema.shape.reclaimMinIdleHours.safeParse(
          hours,
        ).success;
      const { user } = render(<EditorView />);
      await user.clear(hoursInput());
      await user.type(hoursInput(), String(hours));
      await user.tab();
      if (accepted) {
        expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
        expect(screen.queryByText(INVALID_HOURS)).not.toBeInTheDocument();
      } else {
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
        expect(await screen.findByText(INVALID_HOURS)).toBeInTheDocument();
      }
    },
  );

  it('returns an invalid size to the one it held when the cap is switched off', async () => {
    const { user } = render(<EditorView />);
    await user.click(capSwitch());
    await user.clear(sizeInput());
    await user.type(sizeInput(), '0');
    await user.tab();
    expect(await screen.findByText(INVALID_SIZE)).toBeInTheDocument();
    await user.click(capSwitch());
    expect(sizeInput()).toHaveValue(50);
    expect(screen.queryByText(INVALID_SIZE)).not.toBeInTheDocument();
  });
});

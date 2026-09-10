import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ActiveEditorProvider,
  EditorActions,
  EditorGroup,
  useActiveEditor,
} from '@/app/components/ui/editor';
import { render, screen, waitFor } from '@/tests/utils/render';

import { SandboxQuotaEditor } from './sandbox-quota-editor';

const { state, save } = vi.hoisted(() => ({
  state: {
    canEdit: true,
    usage: {
      isLoading: false,
      data: [
        { budget: 'project', used: 1, cap: 2 },
        { budget: 'workflow', used: 3, cap: 7 },
        { budget: 'render', used: 0, cap: 9 },
      ] as Array<{ budget: string; used: number; cap: number }> | undefined,
    },
  },
  save: vi.fn(),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ cannot: () => !state.canEdit }),
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => state.usage,
}));
vi.mock('../governance/hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: save }),
}));

function HeaderActions() {
  const editor = useActiveEditor();
  return editor ? <EditorActions controller={editor} /> : null;
}

function renderEditor() {
  return render(
    <ActiveEditorProvider>
      <HeaderActions />
      <EditorGroup>
        <SandboxQuotaEditor organizationId="org-1" />
      </EditorGroup>
    </ActiveEditorProvider>,
  );
}

beforeEach(() => {
  state.canEdit = true;
  state.usage.isLoading = false;
  state.usage.data = [
    { budget: 'project', used: 1, cap: 2 },
    { budget: 'workflow', used: 3, cap: 7 },
    { budget: 'render', used: 0, cap: 9 },
  ];
  save.mockReset().mockResolvedValue(null);
});

describe('SandboxQuotaEditor', () => {
  it('saves all three budgets through the shared settings header', async () => {
    const { user } = renderEditor();
    for (const [label, value] of [
      ['Project agent sessions', '5'],
      ['Workflow sessions', '11'],
      ['Render sessions', '13'],
    ]) {
      const input = screen.getByRole('spinbutton', { name: label });
      await user.clear(input);
      await user.type(input, value);
    }
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        organizationId: 'org-1',
        policyType: 'sandbox_quota',
        config: {
          maxSessionsPerOrg: 5,
          maxWorkflowSessionsPerOrg: 11,
          maxRenderSessionsPerOrg: 13,
        },
      }),
    );
  });

  it('preserves the other two configured limits when editing only one', async () => {
    const { user } = renderEditor();
    const input = screen.getByRole('spinbutton', {
      name: 'Project agent sessions',
    });
    await user.clear(input);
    await user.type(input, '6');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          config: {
            maxSessionsPerOrg: 6,
            maxWorkflowSessionsPerOrg: 7,
            maxRenderSessionsPerOrg: 9,
          },
        }),
      ),
    );
  });

  it('discards edits without changing persisted allocation usage', async () => {
    const { user } = renderEditor();
    const input = screen.getByRole('spinbutton', { name: 'Workflow sessions' });
    await user.clear(input);
    await user.type(input, '12');
    expect(screen.getByText('Allocated: 3 / 7')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(input).toHaveValue(7);
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    ['Project agent sessions', '0'],
    ['Workflow sessions', '501'],
    ['Render sessions', '2.5'],
  ])('rejects an invalid %s limit', async (label, value) => {
    const { user } = renderEditor();
    const input = screen.getByRole('spinbutton', { name: label });
    await user.clear(input);
    await user.type(input, value);
    await user.tab();
    expect(
      await screen.findByText('Must be a whole number between 1 and 500.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });

  it('lets readers see limits without editable fields or Save/Discard', () => {
    state.canEdit = false;
    renderEditor();
    for (const input of screen.getAllByRole('spinbutton')) {
      expect(input).toBeDisabled();
    }
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Discard' }),
    ).not.toBeInTheDocument();
  });

  it('shows unavailable allocation data without substituting a zero', () => {
    state.usage.data = undefined;
    renderEditor();
    expect(screen.getAllByText('Allocation data unavailable')).toHaveLength(3);
    expect(screen.queryByText(/Allocated:/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
    for (const input of screen.getAllByRole('spinbutton')) {
      expect(input).toBeDisabled();
      expect(input).toHaveValue(null);
    }
  });
});

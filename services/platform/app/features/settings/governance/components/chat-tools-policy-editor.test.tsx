/**
 * Settings > Governance > Policies & Limits: what the chat assistant may make
 * besides its answers. A missing policy reads as every tool on — what the
 * chat offers without one — and the switches save together through the
 * page's Save/Discard cluster as the `chat_tools` policy.
 */

import {
  ActiveEditorProvider,
  DirtyBlockerProvider,
  EditorActions,
  EditorGroup,
  useActiveEditor,
} from '@tale/ui/editor';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import { ChatToolsPolicyEditor } from './chat-tools-policy-editor';

const { state, saved } = vi.hoisted(() => ({
  saved: vi.fn(),
  state: {
    config: null as unknown,
    canEdit: true,
  },
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => state.canEdit }),
}));
vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: saved }),
}));
vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: state.config === null ? null : { config: state.config },
    isLoading: false,
  }),
}));

function HeaderActions() {
  const editor = useActiveEditor();
  return editor ? <EditorActions controller={editor} /> : null;
}

async function renderEditor() {
  const root = createRootRoute({ component: Outlet });
  const route = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/$id/settings/governance/policies-limits',
    component: () => (
      <DirtyBlockerProvider>
        <ActiveEditorProvider>
          <HeaderActions />
          <EditorGroup>
            <ChatToolsPolicyEditor organizationId="org-1" />
          </EditorGroup>
        </ActiveEditorProvider>
      </DirtyBlockerProvider>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: ['/dashboard/org-1/settings/governance/policies-limits'],
    }),
  });
  const result = render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: 'Chat tools' });
  return result;
}

const toolSwitch = (name: string) => screen.getByRole('switch', { name });

beforeEach(() => {
  saved.mockReset().mockResolvedValue(null);
  state.config = null;
  state.canEdit = true;
});

describe('ChatToolsPolicyEditor', () => {
  it('reads a missing policy as every tool on', async () => {
    await renderEditor();
    expect(toolSwitch('Files')).toBeChecked();
    expect(toolSwitch('Skills')).toBeChecked();
    expect(toolSwitch('Code')).toBeChecked();
  });

  it('shows the switches a stored policy puts in force', async () => {
    state.config = { files: true, skills: false, code: false };
    await renderEditor();
    expect(toolSwitch('Files')).toBeChecked();
    expect(toolSwitch('Skills')).not.toBeChecked();
    expect(toolSwitch('Code')).not.toBeChecked();
  });

  it('saves the switches together as the chat_tools policy', async () => {
    const { user } = await renderEditor();
    await user.click(toolSwitch('Code'));
    expect(saved).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        organizationId: 'org-1',
        policyType: 'chat_tools',
        config: { files: true, skills: true, code: false },
      }),
    );
  });

  it('describes what each tool does and what the code tool costs', async () => {
    await renderEditor();
    expect(toolSwitch('Files')).toHaveAccessibleDescription(
      /No sandbox starts/,
    );
    expect(toolSwitch('Code')).toHaveAccessibleDescription(
      /light sandbox limit under Sandboxes/,
    );
  });

  it('shows a viewer who cannot edit the switches without Save or Discard', async () => {
    state.canEdit = false;
    await renderEditor();
    expect(toolSwitch('Files')).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
  });
});

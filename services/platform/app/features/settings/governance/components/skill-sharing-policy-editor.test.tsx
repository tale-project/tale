/**
 * Settings > Governance > Policies & Limits: who may share a skill with the
 * whole organization. A missing policy reads as Every member — the behaviour
 * before the policy existed — and a choice saves through the page's
 * Save/Discard cluster as the `skill_sharing` policy.
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

import { SkillSharingPolicyEditor } from './skill-sharing-policy-editor';

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
            <SkillSharingPolicyEditor organizationId="org-1" />
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
  await screen.findByRole('heading', { name: 'Skill sharing' });
  return result;
}

beforeEach(() => {
  saved.mockReset().mockResolvedValue(null);
  state.config = null;
  state.canEdit = true;
});

describe('SkillSharingPolicyEditor', () => {
  it('reads a missing policy as Every member', async () => {
    await renderEditor();
    expect(
      screen.getByRole('combobox', {
        name: 'Share skills with the organization',
      }),
    ).toHaveTextContent('Every member');
  });

  it('shows the mode a stored policy puts in force', async () => {
    state.config = { orgWide: 'editors' };
    await renderEditor();
    expect(
      screen.getByRole('combobox', {
        name: 'Share skills with the organization',
      }),
    ).toHaveTextContent('Editors and above');
  });

  it('saves the chosen mode as the skill_sharing policy', async () => {
    const { user } = await renderEditor();
    await user.click(
      screen.getByRole('combobox', {
        name: 'Share skills with the organization',
      }),
    );
    await user.click(
      await screen.findByRole('option', { name: 'Owners and admins only' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        organizationId: 'org-1',
        policyType: 'skill_sharing',
        config: { orgWide: 'admins' },
      }),
    );
  });

  it('shows a viewer who cannot edit the mode without Save or Discard', async () => {
    state.canEdit = false;
    state.config = { orgWide: 'admins' };
    await renderEditor();
    expect(
      screen.getByRole('combobox', {
        name: 'Share skills with the organization',
      }),
    ).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
  });
});

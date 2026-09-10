import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ActiveEditorProvider,
  EditorActions,
  EditorGroup,
  useActiveEditor,
} from '@/app/components/ui/editor';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { render, screen, waitFor } from '@/tests/utils/render';

import { SandboxQuotaEditor } from './sandbox-quota-editor';

import '@/app/globals.css';

afterEach(cleanup);

const { saved } = vi.hoisted(() => ({ saved: vi.fn() }));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ cannot: () => false }),
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({
    isLoading: false,
    data: [
      { budget: 'project', used: 1, cap: 2 },
      { budget: 'workflow', used: 0, cap: 4 },
      { budget: 'render', used: 0, cap: 4 },
    ],
  }),
}));
vi.mock('../governance/hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: saved }),
}));

function HeaderActions() {
  const controller = useActiveEditor();
  return controller ? <EditorActions controller={controller} /> : null;
}

describe('sandbox limit keyboard interaction in Chromium', () => {
  it('saves with Ctrl+S and discards a later edit through the common header', async () => {
    saved.mockReset().mockResolvedValue(null);
    const { user } = render(
      <ActiveEditorProvider>
        <HeaderActions />
        <SettingsPage>
          <EditorGroup>
            <SandboxQuotaEditor organizationId="org-test" />
          </EditorGroup>
        </SettingsPage>
      </ActiveEditorProvider>,
    );
    const workflow = screen.getByRole('spinbutton', {
      name: 'Workflow sessions',
    });
    await user.clear(workflow);
    await user.type(workflow, '8');
    await user.tab();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        organizationId: 'org-test',
        policyType: 'sandbox_quota',
        config: {
          maxSessionsPerOrg: 2,
          maxWorkflowSessionsPerOrg: 8,
          maxRenderSessionsPerOrg: 4,
        },
      }),
    );
    const renderLimit = screen.getByRole('spinbutton', {
      name: 'Render sessions',
    });
    await user.clear(renderLimit);
    await user.type(renderLimit, '12');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(renderLimit).toHaveValue(4);
    expect(saved).toHaveBeenCalledOnce();
  });
});

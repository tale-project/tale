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
import type { SandboxQuotaConfig } from '@/lib/shared/schemas/governance';
import { render, screen, waitFor } from '@/tests/utils/render';

import { SandboxQuotaEditor } from './sandbox-quota-editor';

import '@/app/globals.css';

afterEach(cleanup);

const { saved, state } = vi.hoisted(() => ({
  saved: vi.fn(),
  state: {
    config: {
      maxSessionsPerOrg: 2,
      maxWorkflowSessionsPerOrg: 2,
      maxRenderSessionsPerOrg: 2,
    },
  },
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ cannot: () => false }),
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({
    isLoading: false,
    data: [
      { budget: 'project', used: 1, cap: state.config.maxSessionsPerOrg },
      {
        budget: 'workflow',
        used: 0,
        cap: state.config.maxWorkflowSessionsPerOrg,
      },
      { budget: 'render', used: 0, cap: state.config.maxRenderSessionsPerOrg },
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
  it.each(['light', 'dark'])(
    'corrects an excess, saves at capacity with Ctrl+S, and discards in %s mode',
    async (theme) => {
      state.config = {
        maxSessionsPerOrg: 2,
        maxWorkflowSessionsPerOrg: 2,
        maxRenderSessionsPerOrg: 2,
      };
      saved
        .mockReset()
        .mockImplementation(({ config }: { config: SandboxQuotaConfig }) => {
          state.config = config;
          return Promise.resolve(null);
        });
      const { user } = render(
        <div className={theme}>
          <ActiveEditorProvider>
            <HeaderActions />
            <SettingsPage>
              <EditorGroup>
                <SandboxQuotaEditor
                  organizationId="org-test"
                  deploymentLimits={{ status: 'available', maxSessions: 16 }}
                  deploymentLimitsLoading={false}
                  onRefreshDeploymentLimits={vi.fn()}
                />
              </EditorGroup>
            </SettingsPage>
          </ActiveEditorProvider>
        </div>,
      );
      const total = screen.getByRole('status', {
        name: 'Total organization sessions',
      });
      expect(total).toHaveTextContent('6 / 16');
      const workflow = screen.getByRole('spinbutton', {
        name: 'Workflow sessions',
      });
      await user.clear(workflow);
      await user.type(workflow, '13');
      expect(total).toHaveTextContent('17 / 16');
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      expect(workflow).toHaveFocus();
      const error = screen.getByRole('alert');
      expect(workflow).toHaveAccessibleDescription(error.textContent ?? '');
      expect(error.getBoundingClientRect().width).toBeGreaterThan(0);
      expect(error.getBoundingClientRect().right).toBeLessThanOrEqual(
        window.innerWidth,
      );

      await user.clear(workflow);
      await user.type(workflow, '12');
      await user.tab();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
      );
      expect(total).toHaveTextContent('16 / 16');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await user.keyboard('{Control>}s{/Control}');
      await waitFor(() =>
        expect(saved).toHaveBeenCalledWith({
          organizationId: 'org-test',
          policyType: 'sandbox_quota',
          config: {
            maxSessionsPerOrg: 2,
            maxWorkflowSessionsPerOrg: 12,
            maxRenderSessionsPerOrg: 2,
          },
        }),
      );
      const renderLimit = screen.getByRole('spinbutton', {
        name: 'Render sessions',
      });
      await user.clear(renderLimit);
      await user.type(renderLimit, '3');
      expect(total).toHaveTextContent('17 / 16');
      await user.click(screen.getByRole('button', { name: 'Discard' }));
      expect(renderLimit).toHaveValue(2);
      expect(workflow).toHaveValue(12);
      expect(total).toHaveTextContent('16 / 16');
      expect(saved).toHaveBeenCalledOnce();
    },
  );
});

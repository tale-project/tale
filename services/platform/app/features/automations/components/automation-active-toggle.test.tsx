// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import { render, screen, waitFor } from '@/test/utils/render';

import { AutomationActiveToggle } from './automation-active-toggle';

const mockToggleEnabled = vi.fn();

vi.mock('../hooks/file-mutations', async (importOriginal) => ({
  ...(await importOriginal()),
  useToggleWorkflowEnabled: () => ({
    mutate: mockToggleEnabled,
    mutateAsync: mockToggleEnabled,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    data: undefined,
    reset: vi.fn(),
  }),
}));

vi.mock('@/app/hooks/use-convex-auth', () => ({
  useAuth: () => ({
    user: { userId: 'user-1', email: 'test@example.com' },
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

function createAutomation(
  overrides: Partial<{ _id: string; name: string; status: string }> = {},
) {
  return {
    _id: 'wf-1',
    name: 'Test Automation',
    status: 'active',
    ...overrides,
  };
}

describe('AutomationActiveToggle', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mockToggleEnabled.mockResolvedValue(null);
  });

  describe('rendering', () => {
    it('renders checked switch when automation is active', () => {
      render(<AutomationActiveToggle automation={createAutomation()} />);
      const toggle = screen.getByRole('switch');
      expect(toggle).toHaveAttribute('data-state', 'checked');
    });

    it('renders unchecked switch when automation is archived', () => {
      render(
        <AutomationActiveToggle
          automation={createAutomation({ status: 'archived' })}
        />,
      );
      const toggle = screen.getByRole('switch');
      expect(toggle).toHaveAttribute('data-state', 'unchecked');
    });

    it('renders disabled switch when automation is draft', () => {
      render(
        <AutomationActiveToggle
          automation={createAutomation({ status: 'draft' })}
        />,
      );
      const toggle = screen.getByRole('switch');
      expect(toggle).toBeDisabled();
    });

    it('renders with label when provided', () => {
      render(
        <AutomationActiveToggle
          automation={createAutomation()}
          label="Active"
        />,
      );
      expect(screen.getByText('Active')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls toggleEnabled when toggling on an archived automation', async () => {
      const { user } = render(
        <AutomationActiveToggle
          automation={createAutomation({ status: 'archived' })}
        />,
      );

      await user.click(screen.getByRole('switch'));

      await waitFor(() => {
        expect(mockToggleEnabled).toHaveBeenCalledWith({
          orgSlug: 'default',
          workflowSlug: 'wf-1',
        });
      });
    });

    it('shows confirmation dialog when toggling off an active automation', async () => {
      const { user } = render(
        <AutomationActiveToggle
          automation={createAutomation({ name: 'My Workflow' })}
        />,
      );

      await user.click(screen.getByRole('switch'));

      expect(screen.getByText('Deactivate automation')).toBeInTheDocument();
      expect(mockToggleEnabled).not.toHaveBeenCalled();
    });

    it('calls toggleEnabled when confirming deactivation', async () => {
      const { user } = render(
        <AutomationActiveToggle
          automation={createAutomation({ name: 'My Workflow' })}
        />,
      );

      await user.click(screen.getByRole('switch'));

      const confirmButton = screen.getByRole('button', {
        name: /deactivate/i,
      });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(mockToggleEnabled).toHaveBeenCalledWith({
          orgSlug: 'default',
          workflowSlug: 'wf-1',
        });
      });
    });

    it('does not toggle when draft automation is clicked', async () => {
      const { user } = render(
        <AutomationActiveToggle
          automation={createAutomation({ status: 'draft' })}
        />,
      );

      await user.click(screen.getByRole('switch'));

      expect(mockToggleEnabled).not.toHaveBeenCalled();
    });
  });
});

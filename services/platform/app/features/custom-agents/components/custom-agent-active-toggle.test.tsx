// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import { render, screen, waitFor } from '@/test/utils/render';

import { CustomAgentActiveToggle } from './custom-agent-active-toggle';

const mockActivateVersion = vi.fn();
const mockPublish = vi.fn();
const mockUnpublish = vi.fn();

vi.mock('../hooks/mutations', async (importOriginal) => ({
  ...(await importOriginal()),
  useActivateCustomAgentVersion: () => mockActivateVersion,
  usePublishCustomAgent: () => mockPublish,
  useUnpublishCustomAgent: () => mockUnpublish,
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

function createAgent(
  overrides: Partial<{
    _id: string;
    displayName: string;
    rootVersionId: string;
    status: 'draft' | 'active' | 'archived';
    versionNumber: number;
  }> = {},
) {
  return {
    _id: 'agent-1',
    displayName: 'Test Agent',
    rootVersionId: 'agent-root-1',
    status: 'active' as const,
    versionNumber: 1,
    ...overrides,
  };
}

describe('CustomAgentActiveToggle', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mockActivateVersion.mockResolvedValue(null);
    mockPublish.mockResolvedValue(null);
    mockUnpublish.mockResolvedValue(null);
  });

  describe('rendering', () => {
    it('renders checked switch when agent is active', () => {
      render(<CustomAgentActiveToggle agent={createAgent()} />);
      const toggle = screen.getByRole('switch');
      expect(toggle).toHaveAttribute('data-state', 'checked');
    });

    it('renders unchecked switch when agent is archived', () => {
      render(
        <CustomAgentActiveToggle agent={createAgent({ status: 'archived' })} />,
      );
      const toggle = screen.getByRole('switch');
      expect(toggle).toHaveAttribute('data-state', 'unchecked');
    });

    it('renders disabled switch when agent is an unpublished draft', () => {
      render(
        <CustomAgentActiveToggle
          agent={createAgent({ status: 'draft', versionNumber: 1 })}
        />,
      );
      const toggle = screen.getByRole('switch');
      expect(toggle).toBeDisabled();
    });

    it('renders enabled switch when agent is a draft with published versions', () => {
      render(
        <CustomAgentActiveToggle
          agent={createAgent({ status: 'draft', versionNumber: 2 })}
        />,
      );
      const toggle = screen.getByRole('switch');
      expect(toggle).toBeEnabled();
    });

    it('renders with label when provided', () => {
      render(<CustomAgentActiveToggle agent={createAgent()} label="Active" />);
      expect(screen.getByText('Active')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls activateVersion when toggling on an archived agent', async () => {
      const { user } = render(
        <CustomAgentActiveToggle
          agent={createAgent({ status: 'archived', versionNumber: 2 })}
        />,
      );

      await user.click(screen.getByRole('switch'));

      await waitFor(() => {
        expect(mockActivateVersion).toHaveBeenCalledWith({
          customAgentId: 'agent-root-1',
          targetVersion: 2,
        });
      });
    });

    it('calls publishCustomAgent when toggling on a draft with published versions', async () => {
      const { user } = render(
        <CustomAgentActiveToggle
          agent={createAgent({ status: 'draft', versionNumber: 2 })}
        />,
      );

      await user.click(screen.getByRole('switch'));

      await waitFor(() => {
        expect(mockPublish).toHaveBeenCalledWith({
          customAgentId: 'agent-root-1',
        });
        expect(mockActivateVersion).not.toHaveBeenCalled();
      });
    });

    it('shows confirmation dialog when toggling off an active agent', async () => {
      const { user } = render(
        <CustomAgentActiveToggle
          agent={createAgent({ displayName: 'My Agent' })}
        />,
      );

      await user.click(screen.getByRole('switch'));

      expect(screen.getByText('Deactivate agent')).toBeInTheDocument();
      expect(mockUnpublish).not.toHaveBeenCalled();
    });

    it('calls unpublish when confirming deactivation', async () => {
      const { user } = render(
        <CustomAgentActiveToggle
          agent={createAgent({ displayName: 'My Agent' })}
        />,
      );

      await user.click(screen.getByRole('switch'));

      const confirmButton = screen.getByRole('button', {
        name: /deactivate/i,
      });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(mockUnpublish).toHaveBeenCalledWith({
          customAgentId: 'agent-root-1',
        });
      });
    });

    it('does not toggle when unpublished draft agent is clicked', async () => {
      const { user } = render(
        <CustomAgentActiveToggle
          agent={createAgent({ status: 'draft', versionNumber: 1 })}
        />,
      );

      await user.click(screen.getByRole('switch'));

      expect(mockActivateVersion).not.toHaveBeenCalled();
      expect(mockPublish).not.toHaveBeenCalled();
      expect(mockUnpublish).not.toHaveBeenCalled();
    });
  });
});

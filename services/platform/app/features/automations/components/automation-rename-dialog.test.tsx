// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/test/utils/render';

import { AutomationRenameDialog } from './automation-rename-dialog';

const mockToast = vi.fn();

vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'org-123' }),
}));

describe('AutomationRenameDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    currentName: 'My Automation',
    onRename: vi.fn(),
  };

  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onRename.mockResolvedValue(undefined);
  });

  it('renders with current name', () => {
    render(<AutomationRenameDialog {...defaultProps} />);

    const input = screen.getByDisplayValue('My Automation');
    expect(input).toBeInTheDocument();
  });

  it('closes without calling onRename when name is unchanged', async () => {
    const { user } = render(<AutomationRenameDialog {...defaultProps} />);

    const submitButton = screen.getByRole('button', { name: /save/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(defaultProps.onRename).not.toHaveBeenCalled();
  });

  it('calls onRename and closes dialog on success', async () => {
    const { user } = render(<AutomationRenameDialog {...defaultProps} />);

    const input = screen.getByDisplayValue('My Automation');
    await user.clear(input);
    await user.type(input, 'New Name');

    const submitButton = screen.getByRole('button', { name: /save/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(defaultProps.onRename).toHaveBeenCalledWith('New Name');
    });
    await waitFor(() => {
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('shows error toast and keeps dialog open when onRename fails', async () => {
    defaultProps.onRename.mockRejectedValueOnce(new Error('Network error'));

    const { user } = render(<AutomationRenameDialog {...defaultProps} />);

    const input = screen.getByDisplayValue('My Automation');
    await user.clear(input);
    await user.type(input, 'New Name');

    const submitButton = screen.getByRole('button', { name: /save/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
        }),
      );
    });

    // Dialog should NOT have been closed
    expect(defaultProps.onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

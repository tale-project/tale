// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

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

  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onRename.mockResolvedValue(undefined);
  });

  it('renders with current name', () => {
    render(<AutomationRenameDialog {...defaultProps} />);

    const input = screen.getByDisplayValue('My Automation');
    expect(input).toBeInTheDocument();
  });

  it('disables save button when name is unchanged', () => {
    render(<AutomationRenameDialog {...defaultProps} />);

    const submitButton = screen.getByRole('button', { name: /save/i });
    expect(submitButton).toBeDisabled();
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

  it('shows an inline field error (not a toast) when the name already exists', async () => {
    defaultProps.onRename.mockRejectedValueOnce(
      new ConvexError({ code: 'DUPLICATE_NAME', message: 'exists' }),
    );

    const { user } = render(<AutomationRenameDialog {...defaultProps} />);

    const input = screen.getByDisplayValue('My Automation');
    await user.clear(input);
    await user.type(input, 'Taken Name');

    const submitButton = screen.getByRole('button', { name: /save/i });
    await user.click(submitButton);

    // A name collision is surfaced inline on the field…
    await waitFor(() => {
      expect(
        screen.getByText(
          'An automation with a matching identifier already exists. Try a more distinct name.',
        ),
      ).toBeInTheDocument();
    });
    // …with no destructive toast, and the dialog stays open.
    expect(mockToast).not.toHaveBeenCalled();
    expect(defaultProps.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <AutomationRenameDialog {...defaultProps} />,
      );
      await checkAccessibility(container);
    });
  });
});

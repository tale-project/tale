import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen, waitFor } from '@/test/utils/render';

import { MessageFeedback } from '../message-feedback';

let mockSubmitFeedback: Mock;
let mockRemoveFeedback: Mock;
let mockFeedback: { rating: 'positive' | 'negative'; comment?: string } | null =
  null;

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'feedback.thumbsUp': 'Thumbs up',
        'feedback.thumbsDown': 'Thumbs down',
        'feedback.commentPlaceholder': 'What could be improved?',
        'feedback.submitComment': 'Submit',
        'feedback.cancel': 'Cancel',
      };
      return translations[key] ?? key;
    },
  }),
}));

vi.mock('../../hooks/use-message-feedback', () => ({
  useMessageFeedback: () => ({
    feedback: mockFeedback,
    isLoading: false,
    submitFeedback: mockSubmitFeedback,
    removeFeedback: mockRemoveFeedback,
  }),
}));

const defaultProps = {
  messageId: 'msg-1',
  threadId: 'thread-1',
  organizationId: 'org-1',
};

describe('MessageFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFeedback = null;
    mockSubmitFeedback = vi.fn().mockResolvedValue(undefined);
    mockRemoveFeedback = vi.fn().mockResolvedValue(undefined);
  });

  describe('rendering', () => {
    it('renders thumbs up and thumbs down buttons', () => {
      render(<MessageFeedback {...defaultProps} />);

      expect(
        screen.getByRole('button', { name: 'Thumbs up' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Thumbs down' }),
      ).toBeInTheDocument();
    });

    it('does not show comment box by default', () => {
      render(<MessageFeedback {...defaultProps} />);

      expect(
        screen.queryByPlaceholderText('What could be improved?'),
      ).not.toBeInTheDocument();
    });
  });

  describe('positive feedback', () => {
    it('calls submitFeedback with positive when clicking thumbs up', async () => {
      const { user } = render(<MessageFeedback {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: 'Thumbs up' }));

      await waitFor(() => {
        expect(mockSubmitFeedback).toHaveBeenCalledWith('positive');
      });
    });

    it('calls removeFeedback when clicking active thumbs up', async () => {
      mockFeedback = { rating: 'positive' };
      const { user } = render(<MessageFeedback {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: 'Thumbs up' }));

      await waitFor(() => {
        expect(mockRemoveFeedback).toHaveBeenCalled();
      });
    });

    it('shows filled state when positive feedback exists', () => {
      mockFeedback = { rating: 'positive' };
      render(<MessageFeedback {...defaultProps} />);

      const thumbsUpBtn = screen.getByRole('button', { name: 'Thumbs up' });
      expect(thumbsUpBtn).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('negative feedback', () => {
    it('calls submitFeedback with negative when clicking thumbs down', async () => {
      const { user } = render(<MessageFeedback {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: 'Thumbs down' }));

      await waitFor(() => {
        expect(mockSubmitFeedback).toHaveBeenCalledWith('negative');
      });
    });

    it('shows comment box after clicking thumbs down', async () => {
      mockSubmitFeedback = vi
        .fn()
        .mockImplementation(async (rating: string) => {
          mockFeedback = {
            rating: rating === 'positive' ? 'positive' : 'negative',
          };
        });

      const { user, rerender } = render(<MessageFeedback {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: 'Thumbs down' }));

      rerender(<MessageFeedback {...defaultProps} />);

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('What could be improved?'),
        ).toBeInTheDocument();
      });
    });

    it('calls removeFeedback when clicking active thumbs down', async () => {
      mockFeedback = { rating: 'negative' };
      const { user } = render(<MessageFeedback {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: 'Thumbs down' }));

      await waitFor(() => {
        expect(mockRemoveFeedback).toHaveBeenCalled();
      });
    });

    it('shows filled state when negative feedback exists', () => {
      mockFeedback = { rating: 'negative' };
      render(<MessageFeedback {...defaultProps} />);

      const thumbsDownBtn = screen.getByRole('button', {
        name: 'Thumbs down',
      });
      expect(thumbsDownBtn).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('comment submission', () => {
    it('submits comment with negative feedback', async () => {
      mockSubmitFeedback = vi
        .fn()
        .mockImplementation(async (rating: string) => {
          mockFeedback = {
            rating: rating === 'positive' ? 'positive' : 'negative',
          };
        });

      const { user, rerender } = render(<MessageFeedback {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: 'Thumbs down' }));

      rerender(<MessageFeedback {...defaultProps} />);

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('What could be improved?'),
        ).toBeInTheDocument();
      });

      await user.type(
        screen.getByPlaceholderText('What could be improved?'),
        'Response was inaccurate',
      );

      await user.click(screen.getByRole('button', { name: 'Submit' }));

      await waitFor(() => {
        expect(mockSubmitFeedback).toHaveBeenCalledWith(
          'negative',
          'Response was inaccurate',
        );
      });
    });

    it('hides comment box when cancel is clicked', async () => {
      mockSubmitFeedback = vi
        .fn()
        .mockImplementation(async (rating: string) => {
          mockFeedback = {
            rating: rating === 'positive' ? 'positive' : 'negative',
          };
        });

      const { user, rerender } = render(<MessageFeedback {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: 'Thumbs down' }));

      rerender(<MessageFeedback {...defaultProps} />);

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('What could be improved?'),
        ).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(
        screen.queryByPlaceholderText('What could be improved?'),
      ).not.toBeInTheDocument();
    });

    it('disables submit button when comment is empty', async () => {
      mockSubmitFeedback = vi
        .fn()
        .mockImplementation(async (rating: string) => {
          mockFeedback = {
            rating: rating === 'positive' ? 'positive' : 'negative',
          };
        });

      const { user, rerender } = render(<MessageFeedback {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: 'Thumbs down' }));

      rerender(<MessageFeedback {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
      });
    });
  });

  describe('disabled state', () => {
    it('disables buttons while submitting', async () => {
      mockSubmitFeedback = vi.fn().mockReturnValue(new Promise(() => {}));
      const { user } = render(<MessageFeedback {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: 'Thumbs up' }));

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Thumbs up' }),
        ).toBeDisabled();
        expect(
          screen.getByRole('button', { name: 'Thumbs down' }),
        ).toBeDisabled();
      });
    });
  });

  describe('error handling', () => {
    it('re-enables buttons after submitFeedback rejects', async () => {
      mockSubmitFeedback = vi
        .fn()
        .mockRejectedValue(new Error('Network error'));
      const { user } = render(<MessageFeedback {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: 'Thumbs up' }));

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Thumbs up' }),
        ).not.toBeDisabled();
        expect(
          screen.getByRole('button', { name: 'Thumbs down' }),
        ).not.toBeDisabled();
      });
    });

    it('re-enables buttons after removeFeedback rejects', async () => {
      mockFeedback = { rating: 'positive' };
      mockRemoveFeedback = vi
        .fn()
        .mockRejectedValue(new Error('Network error'));
      const { user } = render(<MessageFeedback {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: 'Thumbs up' }));

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Thumbs up' }),
        ).not.toBeDisabled();
        expect(
          screen.getByRole('button', { name: 'Thumbs down' }),
        ).not.toBeDisabled();
      });
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<MessageFeedback {...defaultProps} />);
      await checkAccessibility(container);
    });

    it('passes axe audit with comment box open', async () => {
      mockSubmitFeedback = vi
        .fn()
        .mockImplementation(async (rating: string) => {
          mockFeedback = {
            rating: rating === 'positive' ? 'positive' : 'negative',
          };
        });

      const { user, container, rerender } = render(
        <MessageFeedback {...defaultProps} />,
      );

      await user.click(screen.getByRole('button', { name: 'Thumbs down' }));

      rerender(<MessageFeedback {...defaultProps} />);

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('What could be improved?'),
        ).toBeInTheDocument();
      });

      await checkAccessibility(container);
    });

    it('has correct aria-pressed attributes', () => {
      render(<MessageFeedback {...defaultProps} />);

      expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      expect(
        screen.getByRole('button', { name: 'Thumbs down' }),
      ).toHaveAttribute('aria-pressed', 'false');
    });
  });
});

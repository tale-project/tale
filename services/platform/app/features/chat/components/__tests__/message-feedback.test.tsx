import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { MessageFeedback } from '../message-feedback';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'feedback.thumbsUp': 'Thumbs up',
        'feedback.thumbsDown': 'Thumbs down',
        'feedback.commentPlaceholder': 'Add a comment...',
        'feedback.submitComment': 'Submit',
        'feedback.cancel': 'Cancel',
      };
      return translations[key] ?? key;
    },
  }),
}));

vi.mock('../../hooks/use-message-feedback', () => ({
  useMessageFeedback: () => ({
    feedback: null,
    isLoading: false,
    submitFeedback: vi.fn(),
    removeFeedback: vi.fn(),
  }),
}));

describe('MessageFeedback', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <MessageFeedback
          messageId="msg-1"
          threadId="thread-1"
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });
  });
});

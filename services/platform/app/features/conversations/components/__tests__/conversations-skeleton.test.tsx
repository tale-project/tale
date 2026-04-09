import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import {
  ConversationsListSkeleton,
  ConversationHeaderSkeleton,
  ConversationPanelSkeleton,
} from '../conversations-skeleton';

describe('ConversationsListSkeleton', () => {
  describe('accessibility', () => {
    it('passes axe audit with default rows', async () => {
      const { container } = render(<ConversationsListSkeleton />);
      await checkAccessibility(container);
    });

    it('passes axe audit with custom rows', async () => {
      const { container } = render(<ConversationsListSkeleton rows={5} />);
      await checkAccessibility(container);
    });
  });
});

describe('ConversationHeaderSkeleton', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<ConversationHeaderSkeleton />);
      await checkAccessibility(container);
    });
  });
});

describe('ConversationPanelSkeleton', () => {
  describe('accessibility', () => {
    it('passes axe audit for open status', async () => {
      const { container } = render(<ConversationPanelSkeleton status="open" />);
      await checkAccessibility(container);
    });

    it('passes axe audit for closed status', async () => {
      const { container } = render(
        <ConversationPanelSkeleton status="closed" />,
      );
      await checkAccessibility(container);
    });
  });
});

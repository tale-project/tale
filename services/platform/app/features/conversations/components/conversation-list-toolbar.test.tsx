import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ConversationListToolbar } from './conversation-list-toolbar';

describe('ConversationListToolbar', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ConversationListToolbar>
          <span>Toolbar content</span>
        </ConversationListToolbar>,
      );
      await checkAccessibility(container);
    });
  });
});

import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

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

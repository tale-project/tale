// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { render } from '@/tests/utils/render';

import { ConversationListPanel } from './conversation-list-panel';

describe('ConversationListPanel', () => {
  it('reserves floating-dock clearance on the list scroller', () => {
    const { container } = render(
      <ConversationListPanel>
        <p>Conversation</p>
      </ConversationListPanel>,
    );
    const scroller = container.querySelector('.overflow-y-auto');
    expect(scroller).toHaveClass(
      'pb-[calc(var(--mobile-floating-actions-pad,0px)+var(--mobile-nav-content-pad,0px))]',
    );
  });
});

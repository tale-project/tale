// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

import { ConversationListPanel } from './conversation-list-panel';

const viewport = vi.hoisted(() => ({ mobile: true }));
vi.mock('@tale/ui/use-is-mobile', () => ({
  useIsMobile: () => viewport.mobile,
}));

beforeEach(() => {
  viewport.mobile = true;
});

describe('ConversationListPanel', () => {
  it('does not mount the duplicate list on desktop and mounts it after a mobile resize', () => {
    const Child = vi.fn(() => <p>Conversation</p>);
    viewport.mobile = false;
    const view = render(
      <ConversationListPanel>
        <Child />
      </ConversationListPanel>,
    );
    expect(Child).not.toHaveBeenCalled();
    viewport.mobile = true;
    view.rerender(
      <ConversationListPanel>
        <Child />
      </ConversationListPanel>,
    );
    expect(Child).toHaveBeenCalled();
  });

  it('unmounts mobile list rows while the reading pane owns the screen', () => {
    const Child = vi.fn(() => <p>Conversation</p>);
    const { container } = render(
      <ConversationListPanel hidden>
        <Child />
      </ConversationListPanel>,
    );
    expect(Child).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

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

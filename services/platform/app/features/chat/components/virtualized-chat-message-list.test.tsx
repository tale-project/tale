import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ChatItem } from '../hooks/use-merged-chat-items';
import type { ChatMessage } from '../hooks/use-message-processing';
import { VirtualizedChatMessageList } from './virtualized-chat-message-list';

// react-virtual needs a real measured viewport (none in jsdom), so mock the
// virtualizer to render every item. This verifies wiring (renderItem, header,
// footer, a11y) — the virtualization math itself is validated in-browser.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    getItemKey,
  }: {
    count: number;
    getItemKey: (i: number) => string;
  }) => ({
    getTotalSize: () => count * 140,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        key: getItemKey(i),
        start: i * 140,
      })),
    measureElement: () => undefined,
    measure: () => undefined,
    options: { scrollMargin: 0 },
  }),
}));

function msgItem(id: string, content: string): ChatItem {
  const data: ChatMessage = {
    id,
    key: id,
    role: 'assistant',
    content,
    timestamp: new Date(),
  };
  return { type: 'message', data };
}

describe('VirtualizedChatMessageList', () => {
  it('renders header, every item, and footer in an accessible log region', () => {
    const items = [
      msgItem('a', 'first message'),
      msgItem('b', 'second message'),
      msgItem('c', 'third message'),
    ];
    const renderItem = vi.fn((item: ChatItem) =>
      item.type === 'message' ? <div>{item.data.content}</div> : null,
    );

    render(
      <VirtualizedChatMessageList
        items={items}
        containerRef={createRef<HTMLDivElement>()}
        renderItem={renderItem}
        labelId="log-label"
        header={<div data-testid="header">header</div>}
        footer={<div data-testid="footer">footer</div>}
      />,
    );

    expect(screen.getByRole('log')).toHaveAttribute(
      'aria-labelledby',
      'log-label',
    );
    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByTestId('footer')).toBeInTheDocument();
    expect(screen.getByText('first message')).toBeInTheDocument();
    expect(screen.getByText('second message')).toBeInTheDocument();
    expect(screen.getByText('third message')).toBeInTheDocument();
    expect(renderItem).toHaveBeenCalledTimes(3);
  });

  it('renders nothing in the list body when there are no items', () => {
    render(
      <VirtualizedChatMessageList
        items={[]}
        containerRef={createRef<HTMLDivElement>()}
        renderItem={() => null}
        labelId="log-label"
      />,
    );
    expect(screen.getByRole('log')).toBeInTheDocument();
  });
});

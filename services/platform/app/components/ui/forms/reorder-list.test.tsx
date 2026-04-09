import React from 'react';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ReorderList } from './reorder-list';

vi.mock('framer-motion', () => {
  const Item = ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>;
  const Group = ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>;

  return {
    Reorder: { Group, Item },
    useDragControls: () => ({ start: vi.fn() }),
  };
});

describe('ReorderList', () => {
  const items = [
    { id: '1', label: 'Item A' },
    { id: '2', label: 'Item B' },
  ];

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ReorderList
          items={items}
          onReorder={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
          onRemove={vi.fn()}
          renderItem={({ item }) => <span>{item.label}</span>}
          moveUpLabel="Move up"
          moveDownLabel="Move down"
          dragHandleLabel="Drag to reorder"
          removeLabel="Remove"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit in readonly mode', async () => {
      const { container } = render(
        <ReorderList
          items={items}
          onReorder={vi.fn()}
          onMoveUp={vi.fn()}
          onMoveDown={vi.fn()}
          onRemove={vi.fn()}
          renderItem={({ item }) => <span>{item.label}</span>}
          readonlyOrder
          moveUpLabel="Move up"
          moveDownLabel="Move down"
          dragHandleLabel="Drag to reorder"
          removeLabel="Remove"
        />,
      );
      await checkAccessibility(container);
    });
  });
});

import React from 'react';
import { describe, expect, it, vi } from 'vitest';

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

  const baseProps = {
    onReorder: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onRemove: vi.fn(),
    renderItem: ({ item }: { item: { label: string } }) => (
      <span>{item.label}</span>
    ),
    moveUpLabel: 'Move up',
    moveDownLabel: 'Move down',
    dragHandleLabel: 'Drag to reorder',
    removeLabel: 'Remove',
  };

  // Regression: control buttons inside a <form> must not submit it. Without an
  // explicit type, a native <button> defaults to type="submit", so clicking
  // remove/move would submit the enclosing form (e.g. the create-agent dialog)
  // and spuriously trigger its validation.
  it('renders control buttons as type="button" so they never submit a form', () => {
    const { getAllByLabelText } = render(
      <ReorderList items={items} {...baseProps} />,
    );
    for (const label of ['Move up', 'Move down', 'Remove']) {
      for (const btn of getAllByLabelText(label)) {
        expect(btn).toHaveAttribute('type', 'button');
      }
    }
  });

  // Regression: removing must be blocked at the minimum so the last item can't
  // silently fail to delete — the button is disabled instead.
  it('disables remove once the list is at minItems', () => {
    const { getAllByLabelText } = render(
      <ReorderList items={[items[0]]} minItems={1} {...baseProps} />,
    );
    const [removeBtn] = getAllByLabelText('Remove');
    expect(removeBtn).toBeDisabled();
  });

  it('enables remove while above minItems', () => {
    const { getAllByLabelText } = render(
      <ReorderList items={items} minItems={1} {...baseProps} />,
    );
    for (const btn of getAllByLabelText('Remove')) {
      expect(btn).not.toBeDisabled();
    }
  });
});

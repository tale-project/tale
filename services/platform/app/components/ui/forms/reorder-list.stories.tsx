import type { Meta, StoryObj } from '@storybook/react';

import { useState, useCallback } from 'react';

import { Input } from './input';
import { ReorderList, type ReorderItem } from './reorder-list';

interface TextItem extends ReorderItem {
  text: string;
}

function makeItems(texts: string[]): TextItem[] {
  return texts.map((text, i) => ({ id: String(i + 1), text }));
}

function ReorderListDemo({
  initialItems,
  readonlyOrder,
}: {
  initialItems: TextItem[];
  readonlyOrder?: boolean;
}) {
  const [items, setItems] = useState(initialItems);

  const handleMoveUp = useCallback((index: number) => {
    setItems((prev) => {
      if (index === 0) return prev;
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setItems((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  const handleRemove = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleChange = useCallback((id: string, value: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, text: value } : item)),
    );
  }, []);

  return (
    <ReorderList
      items={items}
      onReorder={setItems}
      onMoveUp={handleMoveUp}
      onMoveDown={handleMoveDown}
      onRemove={handleRemove}
      readonlyOrder={readonlyOrder}
      moveUpLabel="Move up"
      moveDownLabel="Move down"
      dragHandleLabel="Drag to reorder"
      removeLabel="Remove"
      renderItem={({ item, index }) => (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">{index + 1}.</span>
          <Input
            value={item.text}
            onChange={(e) => handleChange(item.id, e.target.value)}
            placeholder="Enter text..."
          />
        </div>
      )}
    />
  );
}

const meta: Meta<typeof ReorderList> = {
  title: 'Forms/ReorderList',
  component: ReorderList,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A drag-and-drop reorderable list with manual up/down controls and remove buttons.

## Usage
\`\`\`tsx
import { ReorderList } from '@/app/components/ui/forms/reorder-list';

<ReorderList
  items={items}
  onReorder={setItems}
  onMoveUp={handleMoveUp}
  onMoveDown={handleMoveDown}
  onRemove={handleRemove}
  renderItem={({ item, index }) => (
    <Input value={item.text} onChange={...} />
  )}
/>
\`\`\`

## Features
- Drag handle for smooth pointer-based reordering
- Up/down arrow buttons for keyboard-accessible reordering
- Remove button per item
- Generic: works with any item type extending \`{ id: string }\`
- Render prop for custom item content

## Accessibility
- Drag handle has \`aria-label\`
- Up/down and remove buttons use \`IconButton\` with \`aria-label\`
- Buttons are disabled at list boundaries
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[480px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ReorderList>;

export const Default: Story = {
  render: () => (
    <ReorderListDemo
      initialItems={makeItems([
        'Help me write a report',
        'Summarize this document',
        'Draft an email response',
      ])}
    />
  ),
};

export const SingleItem: Story = {
  render: () => (
    <ReorderListDemo initialItems={makeItems(['Only item in the list'])} />
  ),
};

export const ManyItems: Story = {
  render: () => (
    <ReorderListDemo
      initialItems={makeItems([
        'First item',
        'Second item',
        'Third item',
        'Fourth item',
        'Fifth item',
        'Sixth item',
      ])}
    />
  ),
};

function CustomLabelsDemo() {
  const [items, setItems] = useState(
    makeItems(['Apples', 'Bananas', 'Cherries']),
  );

  return (
    <ReorderList
      items={items}
      onReorder={setItems}
      onMoveUp={(index) => {
        setItems((prev) => {
          if (index === 0) return prev;
          const next = [...prev];
          [next[index - 1], next[index]] = [next[index], next[index - 1]];
          return next;
        });
      }}
      onMoveDown={(index) => {
        setItems((prev) => {
          if (index >= prev.length - 1) return prev;
          const next = [...prev];
          [next[index], next[index + 1]] = [next[index + 1], next[index]];
          return next;
        });
      }}
      onRemove={(id) => setItems((prev) => prev.filter((i) => i.id !== id))}
      moveUpLabel="Move item up"
      moveDownLabel="Move item down"
      dragHandleLabel="Grab to reorder"
      removeLabel="Delete item"
      renderItem={({ item }) => <span className="text-sm">{item.text}</span>}
    />
  );
}

export const CustomLabels: Story = {
  render: () => <CustomLabelsDemo />,
};

export const ReadonlyOrder: Story = {
  render: () => (
    <ReorderListDemo
      initialItems={makeItems([
        'First item (locked order)',
        'Second item (locked order)',
        'Third item (locked order)',
      ])}
      readonlyOrder
    />
  ),
};

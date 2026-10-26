import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@tale/ui/button';
import {
  CreditCard,
  Keyboard,
  LogOut,
  Mail,
  MessageSquare,
  Plus,
  PlusCircle,
  Settings,
  User,
  UserPlus,
} from 'lucide-react';
import { useState } from 'react';

import { DropdownMenu } from './dropdown-menu';

const meta: Meta<typeof DropdownMenu> = {
  title: 'Overlays/DropdownMenu',
  component: DropdownMenu,
  tags: ['autodocs'],
  args: {
    contentClassName: 'w-56',
  },
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A config-driven dropdown menu component with full keyboard navigation support.

Items are organized into groups (array of arrays). Separators are rendered automatically between groups.

## Usage
\`\`\`tsx
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';

const items: DropdownMenuGroup[] = [
  [{ type: 'label', content: 'My Account' }],
  [
    { type: 'item', label: 'Profile', icon: User, onClick: () => {} },
    { type: 'item', label: 'Settings', icon: Settings, onClick: () => {} },
  ],
  [{ type: 'item', label: 'Log out', icon: LogOut, onClick: () => {} }],
];

<DropdownMenu trigger={<Button>Open Menu</Button>} items={items} />
\`\`\`

## Accessibility
- Full keyboard navigation (Arrow keys, Enter, Escape)
- ARIA menu roles and attributes
- Focus management handled automatically
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof DropdownMenu>;

export const Default: Story = {
  args: {
    trigger: <Button variant="secondary">Open menu</Button>,
    items: [
      [{ type: 'label', content: 'My account' }],
      [
        { type: 'item', label: 'Profile', icon: User, onClick: () => {} },
        {
          type: 'item',
          label: 'Billing',
          icon: CreditCard,
          onClick: () => {},
        },
        {
          type: 'item',
          label: 'Settings',
          icon: Settings,
          onClick: () => {},
        },
        {
          type: 'item',
          label: 'Keyboard shortcuts',
          icon: Keyboard,
          onClick: () => {},
        },
      ],
      [
        {
          type: 'item',
          label: 'Log out',
          icon: LogOut,
          onClick: () => {},
        },
      ],
    ],
  },
};

export const WithSubMenu: Story = {
  args: {
    trigger: <Button variant="secondary">Open menu</Button>,
    items: [
      [{ type: 'label', content: 'Actions' }],
      [
        {
          type: 'item',
          label: 'New item',
          icon: Plus,
          onClick: () => {},
        },
        {
          type: 'sub',
          label: 'Invite users',
          icon: UserPlus,
          items: [
            [
              {
                type: 'item',
                label: 'Email',
                icon: Mail,
                onClick: () => {},
              },
              {
                type: 'item',
                label: 'Message',
                icon: MessageSquare,
                onClick: () => {},
              },
            ],
            [
              {
                type: 'item',
                label: 'More...',
                icon: PlusCircle,
                onClick: () => {},
              },
            ],
          ],
        },
      ],
    ],
  },
};

export const WithRadioItems: Story = {
  render: function Render() {
    const [position, setPosition] = useState('bottom');

    return (
      <DropdownMenu
        trigger={<Button variant="secondary">Panel position</Button>}
        items={[
          [{ type: 'label', content: 'Panel position' }],
          [
            {
              type: 'radio-group',
              value: position,
              onValueChange: setPosition,
              options: [
                { value: 'top', label: 'Top' },
                { value: 'bottom', label: 'Bottom' },
                { value: 'right', label: 'Right' },
              ],
            },
          ],
        ]}
      />
    );
  },
};

export const DisabledItems: Story = {
  args: {
    trigger: <Button variant="secondary">Open menu</Button>,
    items: [
      [
        { type: 'item', label: 'Available action', onClick: () => {} },
        {
          type: 'item',
          label: 'Disabled action',
          onClick: () => {},
          disabled: true,
        },
        { type: 'item', label: 'Another action', onClick: () => {} },
      ],
    ],
  },
};

export const DestructiveItem: Story = {
  args: {
    trigger: <Button variant="secondary">Open menu</Button>,
    items: [
      [
        {
          type: 'item',
          label: 'Edit',
          icon: Settings,
          onClick: () => {},
        },
      ],
      [
        {
          type: 'item',
          label: 'Delete',
          icon: LogOut,
          onClick: () => {},
          destructive: true,
        },
      ],
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Items can be marked as destructive to show a red color.',
      },
    },
  },
};

function SearchableMenu() {
  const [tools, setTools] = useState<readonly string[]>(['task_find']);
  const toggle = (name: string) => (next: boolean) =>
    setTools((current) =>
      next ? [...current, name] : current.filter((tool) => tool !== name),
    );
  const row = (name: string, label: string, description?: string) => ({
    type: 'checkbox' as const,
    label,
    ...(description !== undefined ? { description } : {}),
    checked: tools.includes(name),
    onCheckedChange: toggle(name),
  });
  return (
    <DropdownMenu
      trigger={<Button variant="secondary">Equipment</Button>}
      search={{
        label: 'Search equipment',
        placeholder: 'Search skills, connectors and tools',
        emptyText: 'Nothing matches your search.',
      }}
      items={[
        [
          { type: 'label', content: 'Tasks' },
          row('task_find', 'Find tasks'),
          row('task_create', 'Create tasks', 'Writes data'),
        ],
        [
          { type: 'label', content: 'Knowledge' },
          {
            type: 'checkbox',
            label: 'Search the knowledge base',
            description: 'Always on for every agent',
            checked: true,
            locked: true,
            onCheckedChange: () => {},
          },
          row('knowledge_entry_find', 'Find knowledge entries'),
          row(
            'knowledge_entry_write',
            'Add and edit knowledge entries',
            'Writes data',
          ),
        ],
      ]}
    />
  );
}

export const Searchable: Story = {
  render: () => <SearchableMenu />,
  parameters: {
    docs: {
      description: {
        story:
          'A `search` field narrows long menus as you type; a group label stays while a row under it matches, and Arrow Down moves into the rows. A `locked` checkbox row is always on: shown checked at full strength and announced as unavailable to switch.',
      },
    },
  },
};

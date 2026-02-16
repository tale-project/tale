import type { Meta, StoryObj } from '@storybook/react';

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

import { Button } from '../primitives/button';
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
import { DropdownMenu, type DropdownMenuGroup } from '@/app/components/ui/overlays/dropdown-menu';

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
  render: () => (
    <DropdownMenu
      trigger={<Button variant="secondary">Open Menu</Button>}
      items={[
        [{ type: 'label', content: 'My Account' }],
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
      ]}
    />
  ),
};

export const WithSubMenu: Story = {
  render: () => (
    <DropdownMenu
      trigger={<Button variant="secondary">Open Menu</Button>}
      items={[
        [{ type: 'label', content: 'Actions' }],
        [
          {
            type: 'item',
            label: 'New Item',
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
      ]}
    />
  ),
};

export const WithRadioItems: Story = {
  render: function Render() {
    const [position, setPosition] = useState('bottom');

    return (
      <DropdownMenu
        trigger={<Button variant="secondary">Panel Position</Button>}
        items={[
          [{ type: 'label', content: 'Panel Position' }],
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
  render: () => (
    <DropdownMenu
      trigger={<Button variant="secondary">Open Menu</Button>}
      items={[
        [
          { type: 'item', label: 'Available Action', onClick: () => {} },
          {
            type: 'item',
            label: 'Disabled Action',
            onClick: () => {},
            disabled: true,
          },
          { type: 'item', label: 'Another Action', onClick: () => {} },
        ],
      ]}
    />
  ),
};

export const DestructiveItem: Story = {
  render: () => (
    <DropdownMenu
      trigger={<Button variant="secondary">Open Menu</Button>}
      items={[
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
      ]}
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'Items can be marked as destructive to show a red color.',
      },
    },
  },
};

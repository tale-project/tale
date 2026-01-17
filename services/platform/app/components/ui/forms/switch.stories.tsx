import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { Switch } from './switch';

const meta: Meta<typeof Switch> = {
  title: 'Forms/Switch',
  component: Switch,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A toggle switch component built on Radix UI Switch.

## Usage
\`\`\`tsx
import { Switch } from './switch';

<Switch label="Enable notifications" />
<Switch checked onCheckedChange={(checked) => console.log(checked)} />
\`\`\`

## Accessibility
- Built on Radix UI Switch for full ARIA support
- Smooth thumb animation on toggle
- Label is clickable and properly associated
        `,
      },
    },
  },
  argTypes: {
    label: {
      control: 'text',
      description: 'Label displayed next to the switch',
    },
    checked: {
      control: 'boolean',
      description: 'Checked state',
    },
    required: {
      control: 'boolean',
      description: 'Marks the field as required',
    },
    disabled: {
      control: 'boolean',
      description: 'Disables the switch',
    },
  },
  args: {
    onCheckedChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof Switch>;

export const Default: Story = {
  args: {},
};

export const WithLabel: Story = {
  args: {
    label: 'Enable notifications',
  },
};

export const Checked: Story = {
  args: {
    label: 'Dark mode',
    checked: true,
  },
};

export const Required: Story = {
  args: {
    label: 'Accept cookies',
    required: true,
  },
};

export const Disabled: Story = {
  args: {
    label: 'Feature locked',
    disabled: true,
  },
};

export const DisabledChecked: Story = {
  args: {
    label: 'Always enabled',
    checked: true,
    disabled: true,
  },
};

export const SettingsExample: Story = {
  render: () => (
    <div className="flex flex-col gap-4 w-72">
      <div className="flex items-center justify-between">
        <span className="text-sm">Email notifications</span>
        <Switch defaultChecked />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm">Push notifications</span>
        <Switch />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm">SMS alerts</span>
        <Switch disabled />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Common settings panel layout with switches.',
      },
    },
  },
};

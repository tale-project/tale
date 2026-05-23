import type { Meta, StoryObj } from '@storybook/react-vite';

import { Text } from './text';

const meta: Meta<typeof Text> = {
  title: 'Typography/Text',
  component: Text,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'body',
        'body-sm',
        'muted',
        'caption',
        'label',
        'label-sm',
        'code',
        'error',
        'error-sm',
        'success',
      ],
    },
    as: {
      control: 'select',
      options: ['p', 'span', 'div', 'label', 'h3'],
    },
  },
};
export default meta;

type Story = StoryObj<typeof Text>;

export const Default: Story = { args: { children: 'Standard body text.' } };

export const AllVariants: Story = {
  render: () => (
    <div className="space-y-2">
      <Text variant="body">body — standard prose</Text>
      <Text variant="body-sm">body-sm — small prose</Text>
      <Text variant="muted">muted — secondary text</Text>
      <Text variant="caption">caption — small metadata</Text>
      <Text variant="label">label — field label</Text>
      <Text variant="label-sm">label-sm — small label</Text>
      <Text variant="code">code — monospace token</Text>
      <Text variant="error">error — failure message</Text>
      <Text variant="error-sm">error-sm — small failure note</Text>
      <Text variant="success">success — confirmation</Text>
    </div>
  ),
};

export const Truncated: Story = {
  args: {
    truncate: true,
    children:
      'A very long text that will be truncated with ellipsis when it exceeds the container width.',
  },
  render: (args) => (
    <div className="w-48 border p-2">
      <Text {...args} />
    </div>
  ),
};

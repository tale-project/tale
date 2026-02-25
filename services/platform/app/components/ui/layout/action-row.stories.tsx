import type { Meta, StoryObj } from '@storybook/react';

import { Button } from '../primitives/button';
import { ActionRow } from './action-row';

const meta: Meta<typeof ActionRow> = {
  title: 'Layout/ActionRow',
  component: ActionRow,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A flex row for grouping action buttons with configurable alignment and gap.

## Usage
\`\`\`tsx
import { ActionRow } from '@/app/components/ui/layout/action-row';

<ActionRow justify="end">
  <Button variant="secondary">Cancel</Button>
  <Button>Save</Button>
</ActionRow>
\`\`\`
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof ActionRow>;

export const Default: Story = {
  render: () => (
    <ActionRow>
      <Button variant="secondary">Cancel</Button>
      <Button>Save</Button>
    </ActionRow>
  ),
};

export const JustifyEnd: Story = {
  render: () => (
    <ActionRow justify="end">
      <Button variant="secondary">Cancel</Button>
      <Button>Save</Button>
    </ActionRow>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Buttons aligned to the right — common for form footers.',
      },
    },
  },
};

export const JustifyBetween: Story = {
  render: () => (
    <ActionRow justify="between">
      <Button variant="destructive">Delete</Button>
      <div className="flex gap-2">
        <Button variant="secondary">Cancel</Button>
        <Button>Save</Button>
      </div>
    </ActionRow>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Space-between layout separating a destructive action from primary actions.',
      },
    },
  },
};

export const SmallGap: Story = {
  render: () => (
    <ActionRow gap={1}>
      <Button size="sm" variant="secondary">
        Back
      </Button>
      <Button size="sm">Next</Button>
    </ActionRow>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Reduced gap between adjacent buttons.',
      },
    },
  },
};

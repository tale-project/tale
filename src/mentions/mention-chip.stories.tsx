import type { Meta, StoryObj } from '@storybook/react';

import { MentionChip } from './mention-chip';

const meta: Meta<typeof MentionChip> = {
  title: 'Data Display/MentionChip',
  component: MentionChip,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A mention inside text: \`@\` and the current name on a tinted ground, inline with the words around it. A mention of someone who is gone reads muted, with its reason for screen readers and on hover — never an id.

## Usage
\`\`\`tsx
import { MentionChip } from '@tale/ui/mentions/mention-chip';

<p>
  Ask <MentionChip name="My Opus Agent #3" kindLabel="Agent" /> to review.
</p>
<MentionChip name="Research Bot" missing missingLabel="Deleted agent" />
\`\`\`

## Accessibility
- The name sits in \`<bdi>\`, so a name in another script direction cannot reorder the sentence
- The kind (or why a missing mention is muted) is read after the name; selecting text copies only the name
- Not interactive: no focus stop
        `,
      },
    },
  },
  args: {
    name: 'Ada Lovelace',
    kindLabel: 'Person',
  },
  render: (args) => (
    <p className="max-w-sm text-sm">
      Please check the totals, <MentionChip {...args} />, before Friday.
    </p>
  ),
};

export default meta;
type Story = StoryObj<typeof MentionChip>;

export const Person: Story = {};

export const Agent: Story = {
  args: { name: 'My Opus Agent #3', kindLabel: 'Agent' },
};

export const Missing: Story = {
  args: {
    name: 'Research Bot',
    missing: true,
    missingLabel: 'Deleted agent',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Whoever was mentioned cannot be found any more: the name the text was saved with, muted, and the reason on hover and for screen readers.',
      },
    },
  },
};

export const Wrapping: Story = {
  args: { name: 'Quarterly VAT return preparation desk', kindLabel: 'Agent' },
  render: (args) => (
    <p className="w-48 text-sm">
      Handed over to <MentionChip {...args} /> this morning.
    </p>
  ),
};

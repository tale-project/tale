import type { Meta, StoryObj } from '@storybook/react-vite';

import { Avatar } from './avatar';

const meta: Meta<typeof Avatar> = {
  title: 'Data Display/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
The picture of who said or did something: a person's initials on a tint
hashed from their name, an agent's bot, an automation's workflow glyph,
the system, or an empty (unassigned) slot. Four sizes: 20, 24, 28, 32px.

## Usage
\`\`\`tsx
import { Avatar, getInitials } from '@tale/ui/avatar';

<Avatar name="Anna Meier" label="Anna Meier" />
<Avatar kind="agent" label="Research Bot" size="md" />
<Avatar kind="unassigned" label="Unassigned" size="xs" />
<Avatar name={contact} />  // decorative: the name is written beside it
\`\`\`

## Accessibility
- With \`label\`: \`role="img"\`, \`aria-label\` and a \`title\` tooltip
- Without \`label\`: decorative (\`aria-hidden\`); write the name beside it
- Initials are at least 10px; each tint has a dark-mode pair
        `,
      },
    },
  },
  args: { name: 'Anna Meier', label: 'Anna Meier', size: 'sm' },
  argTypes: {
    kind: {
      control: 'select',
      options: ['person', 'agent', 'automation', 'system', 'unassigned'],
    },
    size: { control: 'select', options: ['xs', 'sm', 'md', 'lg'] },
    tone: {
      control: 'select',
      options: [undefined, 'auto', 'neutral', 'primary', 'strong'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Avatar>;

export const Person: Story = {};

export const Kinds: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Avatar name="Anna Meier" label="Anna Meier" />
      <Avatar name="Kim Lee" label="Kim Lee" />
      <Avatar kind="agent" label="My Opus Agent #3" />
      <Avatar kind="automation" label="Triage inbox" />
      <Avatar kind="system" label="Tale" />
      <Avatar kind="unassigned" label="Unassigned" />
      <Avatar name="Alex Doe" label="You" tone="strong" />
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {(['xs', 'sm', 'md', 'lg'] as const).map((size) => (
        <Avatar key={size} name="Yara Polish" label={size} size={size} />
      ))}
    </div>
  ),
};

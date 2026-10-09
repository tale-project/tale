import type { Meta, StoryObj } from '@storybook/react-vite';
import { Brain, Globe, Search } from 'lucide-react';
import { useState } from 'react';

import { ThinkingDots } from './thinking-dots';
import { TimelineRow } from './timeline-row';

const meta: Meta<typeof TimelineRow> = {
  title: 'Thread/TimelineRow',
  component: TimelineRow,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
One line of a disclosure strip, such as the chat's thinking timeline: an
icon, a chevron (or a spacer of the same width, so every label starts at
one edge), a one-line label and an optional trailing node. \`ThinkingDots\`
is the live "working" mark that trails a running row.

## Usage
\`\`\`tsx
import { ThinkingDots } from '@tale/ui/thread/thinking-dots';
import { TimelineRow } from '@tale/ui/thread/timeline-row';

<TimelineRow
  icon={Brain}
  label="Thinking · 4s"
  trailing={<ThinkingDots />}
  onToggle={toggle}
  expanded={open}
  controls="reasoning"
/>
\`\`\`

## Accessibility
- With \`onToggle\` the row is a button with \`aria-expanded\` (and \`aria-controls\` while open)
- A 20px line keeps a 24px target through an invisible band above and below
- \`ThinkingDots\` is decorative; the label or a live region carries the meaning, and the dots rest under reduced motion
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof TimelineRow>;

function Strip() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex max-w-md flex-col gap-1.5">
      <TimelineRow
        icon={Brain}
        label="Thinking · 4s"
        trailing={<ThinkingDots />}
        onToggle={() => setOpen((value) => !value)}
        expanded={open}
        controls="story-reasoning"
      />
      {open && (
        <p
          id="story-reasoning"
          className="text-muted-foreground border-l pl-3 text-sm"
        >
          The pricing table needs a sticky header; checking Safari first.
        </p>
      )}
      <TimelineRow icon={Search} label="Searched the knowledge base" />
      <TimelineRow icon={Globe} label="Read example.com/pricing" />
    </div>
  );
}

export const ThinkingStrip: Story = { render: () => <Strip /> };

import type { Meta, StoryObj } from '@storybook/react-vite';

import { ReadMore } from './read-more';

const REPORT = Array.from(
  { length: 24 },
  (_, i) =>
    `Step ${i + 1}: checked the pricing table, the annual toggle and the FAQ links on a 390px screen.`,
);

const meta: Meta<typeof ReadMore> = {
  title: 'Data Display/ReadMore',
  component: ReadMore,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
Shows long content at a readable length, with **Read more** / **Show less**
under it. Height mode clamps a block (markdown, a report) to \`maxHeight\`
(320px by default) only when it is taller than \`maxHeight + slack\`; lines
mode clamps a paragraph to \`lines\` with an ellipsis.

## Usage
\`\`\`tsx
import { ReadMore } from '@tale/ui/read-more';

<ReadMore>{report}</ReadMore>
<ReadMore lines={3}><p>{description}</p></ReadMore>
<ReadMore maxHeight={384} contentClassName="bg-muted rounded-2xl px-4 py-2.5" fadeClassName="from-muted" align="end">
  {bubbleText}
</ReadMore>
\`\`\`

## Accessibility
- The content stays in the DOM while clamped: find-in-page, copy and screen readers get the full text
- The toggle is a real button with \`aria-expanded\` and \`aria-controls\` naming the clamped region, 24px tall
- Collapsing a long block scrolls the toggle back into view; focus stays on it
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-full max-w-xl">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ReadMore>;

export const LongReport: Story = {
  render: () => (
    <ReadMore>
      <div className="flex flex-col gap-2 text-sm leading-6">
        {REPORT.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </ReadMore>
  ),
};

export const ShortContent: Story = {
  render: () => (
    <ReadMore>
      <p className="text-sm leading-6">Looks great, ship it.</p>
    </ReadMore>
  ),
};

export const Lines: Story = {
  render: () => (
    <ReadMore lines={3}>
      <p className="text-muted-foreground text-sm">
        {REPORT.slice(0, 6).join(' ')}
      </p>
    </ReadMore>
  ),
};

export const InABubble: Story = {
  render: () => (
    <div className="flex flex-col items-end">
      <ReadMore
        maxHeight={384}
        align="end"
        className="max-w-[75%]"
        contentClassName="bg-muted text-foreground rounded-2xl px-4 py-2.5 text-sm leading-6"
        fadeClassName="from-muted"
      >
        {REPORT.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </ReadMore>
    </div>
  ),
};

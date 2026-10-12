import type { Meta, StoryObj } from '@storybook/react-vite';

import { THREAD_LIST_CLASS } from './layout';
import { ThreadDayDivider } from './thread-day-divider';

const meta: Meta<typeof ThreadDayDivider> = {
  title: 'Thread/ThreadDayDivider',
  component: ThreadDayDivider,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
The day a stretch of a conversation happened: a centred pill between two
hairlines. The pill stays pinned near the top while its day scrolls by;
put the divider first in the element that holds the day's entries.

## Usage
\`\`\`tsx
import { groupByDay } from '@tale/ui/thread/group-by-day';
import { ThreadDayDivider } from '@tale/ui/thread/thread-day-divider';

{groupByDay(entries, (entry) => entry.at).map((day) => (
  <li key={day.key}>
    <ThreadDayDivider>{formatDateHeader(new Date(day.at))}</ThreadDayDivider>
    <ol>{day.entries.map(renderEntry)}</ol>
  </li>
))}
\`\`\`

## Accessibility
- The hairline is decorative (\`aria-hidden\`); the pill's text is read in place
- \`as="h3"\` makes each day a heading when days structure the page
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof ThreadDayDivider>;

export const Divider: Story = {
  args: { children: 'Today' },
};

export const PinnedWhileScrolling: Story = {
  render: () => (
    <div className="h-72 w-full max-w-xl overflow-y-auto rounded-lg border px-4">
      {['Monday, October 5', 'Yesterday', 'Today'].map((day) => (
        <section key={day}>
          <ThreadDayDivider>{day}</ThreadDayDivider>
          <ol className={THREAD_LIST_CLASS}>
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="text-sm">
                {day}: message {i + 1}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  ),
};

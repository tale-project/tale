import type { Meta, StoryObj } from '@storybook/react';

import { Duration } from './duration';

const meta: Meta<typeof Duration> = {
  title: 'Data Display/Duration',
  component: Duration,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A duration in the reader's language, as a \`<time>\` with the exact span in
\`dateTime\`. \`live\` with \`since\` counts on once a second on a clock all
live durations share.

\`\`\`tsx
import { Duration } from '@tale/ui/format-duration';

<Duration ms={3240} />
<Duration since={run.startedAt} live />
\`\`\`
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Duration>;

export const Finished: Story = { args: { ms: 192_000 } };

export const Narrow: Story = { args: { ms: 192_000, unitDisplay: 'narrow' } };

export const Live: Story = {
  args: { since: Date.now() - 42_000, live: true },
};

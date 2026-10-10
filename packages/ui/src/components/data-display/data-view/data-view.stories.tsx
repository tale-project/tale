import type { Meta, StoryObj } from '@storybook/react';

import { DataView } from './data-view';

const meta: Meta<typeof DataView> = {
  title: 'Data Display/DataView',
  component: DataView,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
One recorded value, read as **Values** (a value tree) or as its **Shape**
(the fields it has). Against an expected shape it says whether the value
matches and marks what differs.

\`\`\`tsx
import { DataView } from '@tale/ui/data-view';

<DataView value={output} aria-label="Returned" expected={outputSchema} />
\`\`\`
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="bg-card w-[28rem] rounded-lg border p-3">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof DataView>;

const OUTPUT = {
  summary: 'Login fails on Safari',
  score: 7,
  labels: [{ name: 'bug' }, { name: 'ui', color: 'red' }],
};

export const Default: Story = {
  args: {
    value: OUTPUT,
    'aria-label': 'Returned',
    toolbar: { fullScreen: true, download: { fileName: 'returned.json' } },
  },
};

export const AgainstExpectedShape: Story = {
  args: {
    value: { summary: 3, labels: [] },
    'aria-label': 'Returned',
    expected: {
      type: 'object',
      required: ['summary', 'score'],
      properties: { summary: { type: 'string' }, score: { type: 'number' } },
    },
    expectedLabel: 'From the analysis of v4',
  },
};

export const NothingRecorded: Story = {
  args: { value: undefined, 'aria-label': 'Received' },
};

import type { Meta, StoryObj } from '@storybook/react';

import { DataDiff } from './data-diff';

const meta: Meta<typeof DataDiff> = {
  title: 'Data Display/DataDiff',
  component: DataDiff,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
What changed between two values, one sentence per change, the counts on
top and the unchanged fields folded away; side by side from a 48rem
container. \`mode="shape"\` compares the values' shapes.

\`\`\`tsx
import { DataDiff } from '@tale/ui/data-diff';

<DataDiff before={input} after={output} aria-label="Changes" />
\`\`\`
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="bg-card w-[52rem] max-w-full rounded-lg border p-3">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof DataDiff>;

const BEFORE = {
  title: 'Fix login',
  amount: 250,
  draft: 'old',
  labels: 'bug',
};
const AFTER = {
  title: 'Fix login bug',
  amount: 250,
  labels: ['bug', 'ui'],
  score: 7,
};

export const List: Story = {
  args: { before: BEFORE, after: AFTER, 'aria-label': 'Changes' },
};

export const SideBySide: Story = {
  args: {
    before: BEFORE,
    after: AFTER,
    layout: 'split',
    labels: { before: 'Run A', after: 'Run B' },
    'aria-label': 'Changes',
  },
};

export const Shape: Story = {
  args: {
    before: BEFORE,
    after: AFTER,
    mode: 'shape',
    'aria-label': 'Changes',
  },
};

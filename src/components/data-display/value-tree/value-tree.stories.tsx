import type { Meta, StoryObj } from '@storybook/react';

import type { ValueMark, ValueMarkKind } from './model';
import { ValueTree } from './value-tree';

const meta: Meta<typeof ValueTree> = {
  title: 'Data Display/ValueTree',
  component: ValueTree,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A value as a tree to read and walk with the keyboard: keys, values coloured by
type, lists and objects that open, a page of children at a time, and long text
cut to one line. What a recorder left out (cut text, dropped items, hidden
secrets) shows as chips; marks highlight places by JSON pointer.

\`\`\`tsx
import { ValueTree } from '@tale/ui/value-tree';

<ValueTree value={output} aria-label="Returned" />
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
type Story = StoryObj<typeof ValueTree>;

const ISSUE = {
  title: 'Fix login on Safari',
  number: 1234,
  open: true,
  closedAt: null,
  labels: ['bug', 'ui'],
  author: { login: 'ada', id: 7 },
};

export const Default: Story = {
  args: { value: ISSUE, 'aria-label': 'Issue' },
};

export const Recorded: Story = {
  args: {
    value: { body: 'Steps to reproduce…', apiKey: null, items: [1, 2, 3] },
    'aria-label': 'Input',
    elided: [
      { pointer: '/body', kind: 'string', dropped: 3412 },
      { pointer: '/items', kind: 'items', dropped: 150 },
    ],
    redacted: ['/apiKey'],
    defaultExpandDepth: 2,
  },
};

export const Marked: Story = {
  args: {
    value: { amount: 300, score: 7, summary: 'Ready' },
    'aria-label': 'Output',
    marks: new Map<string, ValueMarkKind | ValueMark>([
      ['/amount', { kind: 'changed', before: 250 }],
      ['/score', 'added'],
      ['/priority', 'missing'],
    ]),
  },
};

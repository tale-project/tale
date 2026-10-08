import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { IssueList, type IssueItem } from './issue-list';

const ISSUES: IssueItem[] = [
  {
    id: 'unknown-node',
    severity: 'error',
    title: 'Reads a node that does not exist',
    location: 'Draft reply › Prompt',
    explanation: 'A template can only read the nodes of this automation.',
    cause: 'The prompt reads "nope", and there is no node with that id.',
    fix: 'Read one of the nodes this automation has, such as "triage".',
    code: 'REF_UNKNOWN_NODE',
    technical: 'nodes.nope is not a node of this automation',
    docsHref: 'https://docs.tale.dev/platform/automations/concepts',
  },
  {
    id: 'maybe-empty',
    severity: 'warning',
    title: 'The output can be empty',
    location: 'Automation output',
    explanation: 'A skipped node has no output, so the result can be empty.',
    cause:
      'The output reads only "draft reply", which is skipped when the triage says no.',
    fix: 'Give the output a fallback value.',
    code: 'OUTPUT_MAYBE_EMPTY',
    unavailableReason: 'Change the output in the YAML view.',
  },
  {
    id: 'never-true',
    severity: 'warning',
    title: 'This condition is never true',
    location: 'Triage › Condition',
    fix: 'Compare against a value the field can hold.',
    code: 'CONDITION_CONSTANT',
  },
];

const meta: Meta<typeof IssueList> = {
  title: 'Feedback/IssueList',
  component: IssueList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A list of problems in the reader's words: severity, title, location, then the
explanation, cause and fix.

## Usage
\`\`\`tsx
import { IssueList } from '@tale/ui/issue-list';

<IssueList issues={issues} onActivate={(issue) => goTo(issue.id)} />
\`\`\`

## Accessibility
- With \`onActivate\`: one tab stop; ↑/↓, Home and End move between rows
- Severity reads by icon shape and a visually hidden "Error:"/"Warning:"
- A row "go to" cannot act on stays focusable and says why on the row
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="bg-background w-full max-w-xl rounded-lg border">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof IssueList>;

function Navigable() {
  const [activeId, setActiveId] = useState<string | null>(null);
  return (
    <IssueList
      issues={ISSUES}
      activeId={activeId}
      onActivate={(issue) => setActiveId(issue.id)}
    />
  );
}

export const Interactive: Story = { render: () => <Navigable /> };

export const Compact: Story = {
  args: { issues: ISSUES, density: 'compact', onActivate: () => {} },
};

/** No `onActivate`: plain rows, for read-only views and node panels. */
export const Static: Story = {
  args: { issues: ISSUES.slice(0, 1), 'aria-label': 'Problems in this node' },
};

export const Checking: Story = {
  args: { issues: ISSUES, status: 'checking', onActivate: () => {} },
};

export const Failed: Story = {
  args: { issues: ISSUES.slice(2), status: 'failed', onActivate: () => {} },
};

export const Empty: Story = { args: { issues: [] } };

import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../primitives/button';
import {
  IssueAnnouncer,
  IssueCountButton,
  type IssueCounts,
} from './issue-summary';

const meta: Meta<typeof IssueCountButton> = {
  title: 'Feedback/IssueCountButton',
  component: IssueCountButton,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
The toggle of a problems panel, and the announcer that speaks a settled check.

## Usage
\`\`\`tsx
import { IssueAnnouncer, IssueCountButton } from '@tale/ui/issue-summary';

<IssueCountButton counts={counts} status={status} expanded={open} controls="problems" onClick={toggle} />
<IssueAnnouncer counts={counts} status={status} announceKey={resultId} />
\`\`\`

## Accessibility
- The name says the counts in words ("Problems: 2 errors and 1 warning")
- The announcer speaks once per settled result, never per keystroke
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof IssueCountButton>;

export const States: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <IssueCountButton counts={{ errors: 2, warnings: 1 }} />
      <IssueCountButton counts={{ errors: 0, warnings: 3 }} />
      <IssueCountButton counts={{ errors: 0, warnings: 0 }} />
      <IssueCountButton counts={{ errors: 2, warnings: 1 }} status="checking" />
      <IssueCountButton counts={{ errors: 2, warnings: 1 }} status="failed" />
    </div>
  ),
};

function Recheck() {
  const [counts, setCounts] = useState<IssueCounts>({ errors: 2, warnings: 1 });
  const [result, setResult] = useState(0);
  const [status, setStatus] = useState<'ready' | 'checking'>('ready');
  const check = (next: IssueCounts) => {
    setStatus('checking');
    setTimeout(() => {
      setCounts(next);
      setResult((value) => value + 1);
      setStatus('ready');
    }, 600);
  };
  return (
    <div className="flex flex-col items-start gap-3">
      <IssueCountButton counts={counts} status={status} />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => check({ errors: 1, warnings: 1 })}
        >
          Fix one error
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => check({ errors: 0, warnings: 0 })}
        >
          Fix everything
        </Button>
      </div>
      <IssueAnnouncer counts={counts} status={status} announceKey={result} />
    </div>
  );
}

/** Each settled check pops the changed count and speaks once to screen readers. */
export const Rechecking: Story = { render: () => <Recheck /> };

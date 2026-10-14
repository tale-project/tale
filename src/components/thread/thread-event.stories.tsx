import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from '@tale/ui/badge';
import { Bot, CircleDot, History, UserRound } from 'lucide-react';
import { useState } from 'react';

import {
  ThreadEvent,
  ThreadEventActor,
  ThreadEventGroup,
} from './thread-event';

const meta: Meta<typeof ThreadEvent> = {
  title: 'Thread/ThreadEvent',
  component: ThreadEvent,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
What happened between messages, as one quiet line in the avatar gutter.
\`ThreadEventGroup\` folds a burst of consecutive events into one summary
line that opens in place.

## Usage
\`\`\`tsx
import {
  ThreadEvent,
  ThreadEventActor,
  ThreadEventGroup,
} from '@tale/ui/thread/thread-event';

<ThreadEvent as="li" icon={CircleDot} time={<ThreadTime value={at} />}>
  <ThreadEventActor>Anna</ThreadEventActor> moved the task to Done
</ThreadEvent>
\`\`\`

## Accessibility
- Each line is a paragraph; with \`detail\` it is a button with \`aria-expanded\` and \`aria-controls\`
- A group's summary is a button that opens a list of its events
- Write each sentence whole in the reader's language; never lower-case a localized label
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <ul className="flex max-w-xl flex-col gap-2">
        <Story />
      </ul>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ThreadEvent>;

export const Event: Story = {
  render: () => (
    <ThreadEvent as="li" icon={CircleDot} time="14:32">
      <ThreadEventActor>Yara Polish</ThreadEventActor> moved the task from To do
      to In progress
    </ThreadEvent>
  ),
};

export const RunWithBadge: Story = {
  render: () => (
    <ThreadEvent
      as="li"
      icon={Bot}
      time="14:40"
      trailing={<Badge variant="destructive">Failed</Badge>}
    >
      <ThreadEventActor>My Opus Agent #3</ThreadEventActor>’s run failed ·
      Couldn’t start
    </ThreadEvent>
  ),
};

function DetailStory() {
  const [open, setOpen] = useState(false);
  return (
    <ThreadEvent
      as="li"
      icon={CircleDot}
      time="14:45"
      expanded={open}
      onToggle={() => setOpen((value) => !value)}
      detail={<p>The new description, in full, for whoever wants it.</p>}
    >
      <ThreadEventActor>Kim Lee</ThreadEventActor> changed the description
    </ThreadEvent>
  );
}

export const WithDetail: Story = { render: () => <DetailStory /> };

export const Group: Story = {
  render: () => (
    <ThreadEventGroup
      as="li"
      icon={History}
      summary="3 updates · Yara Polish, Kim Lee"
      time="14:02 – 14:20"
    >
      <ThreadEvent as="li" icon={CircleDot} time="14:02">
        <ThreadEventActor>Yara Polish</ThreadEventActor> moved the task to In
        progress
      </ThreadEvent>
      <ThreadEvent as="li" icon={UserRound} time="14:10">
        <ThreadEventActor>Kim Lee</ThreadEventActor> assigned My Opus Agent #3
      </ThreadEvent>
      <ThreadEvent as="li" icon={CircleDot} time="14:20">
        <ThreadEventActor>Yara Polish</ThreadEventActor> set the due date to Oct
        12
      </ThreadEvent>
    </ThreadEventGroup>
  ),
};

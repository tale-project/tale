import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar } from '@tale/ui/avatar';
import { Badge } from '@tale/ui/badge';
import { IconButton } from '@tale/ui/icon-button';
import { Pencil, Trash2 } from 'lucide-react';

import { THREAD_COLUMN_CLASS, THREAD_LIST_CLASS } from './layout';
import { ThreadMessage } from './thread-message';

const REPORT = Array.from(
  { length: 20 },
  (_, i) =>
    `${i + 1}. Checked the pricing table at 390px: the annual toggle no longer overlaps the price.`,
);

function Actions() {
  return (
    <>
      <IconButton
        icon={Pencil}
        aria-label="Edit comment"
        variant="ghost"
        size="sm"
        className="size-7"
      />
      <IconButton
        icon={Trash2}
        aria-label="Delete comment"
        variant="ghost"
        size="sm"
        className="size-7"
      />
    </>
  );
}

const meta: Meta<typeof ThreadMessage> = {
  title: 'Thread/ThreadMessage',
  component: ThreadMessage,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
One message of a conversation. \`own\` is the viewer's words, a right-aligned
muted bubble; \`other\` is everyone else, flat prose under an identity row
(avatar, name, role badge, clock time). A \`continuation\` drops the identity
row; \`header={null}\` hides it (the chat's assistant). \`clampHeight\` folds a
long body behind **Read more**.

## Usage
\`\`\`tsx
import { ThreadMessage } from '@tale/ui/thread/thread-message';
import { ThreadTime } from '@tale/ui/thread/thread-time';

<ThreadMessage
  as="li"
  avatar={<Avatar kind="agent" label={agent.name} />}
  author={agent.name}
  badge={<Badge variant="outline">Agent</Badge>}
  time={<ThreadTime value={comment.createdAt} />}
  actions={<CommentActions />}
  clampHeight={320}
>
  <CommentBody />
</ThreadMessage>
\`\`\`

## Accessibility
- Actions show on hover, on keyboard focus anywhere in the message, while a menu is open, and always on touch screens
- The root forwards \`ref\`, classes and \`data-*\`, so list semantics (\`as="li"\`) and anchors stay the host's
- Pass \`<time dateTime title>\` (\`ThreadTime\`) so the exact moment is available without hover
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="@container w-full">
        <ol className={`${THREAD_COLUMN_CLASS} ${THREAD_LIST_CLASS}`}>
          <Story />
        </ol>
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ThreadMessage>;

export const OtherVoice: Story = {
  render: () => (
    <ThreadMessage
      as="li"
      avatar={<Avatar name="Yara Polish" label="Yara Polish" />}
      author="Yara Polish"
      time="14:32"
      actions={<Actions />}
    >
      Looks great. Can you also check the annual toggle on mobile?
    </ThreadMessage>
  ),
};

export const OwnMessage: Story = {
  render: () => (
    <ThreadMessage
      as="li"
      variant="own"
      time="14:35"
      meta="(edited)"
      actions={<Actions />}
    >
      Done — the switch no longer overlaps the price at 390px.
    </ThreadMessage>
  ),
};

export const AgentReportWithContinuation: Story = {
  render: () => (
    <>
      <ThreadMessage
        as="li"
        avatar={<Avatar kind="agent" label="My Opus Agent #3" />}
        author="My Opus Agent #3"
        badge={<Badge variant="outline">Agent</Badge>}
        time="14:40"
        clampHeight={320}
      >
        <div className="flex flex-col gap-2">
          {REPORT.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </ThreadMessage>
      <ThreadMessage as="li" continuation time="14:41">
        Screenshots are in the outputs folder.
      </ThreadMessage>
    </>
  ),
};

export const WithoutIdentity: Story = {
  render: () => (
    <ThreadMessage as="li" header={null}>
      The assistant's answer reads as the page itself, full width.
    </ThreadMessage>
  ),
};

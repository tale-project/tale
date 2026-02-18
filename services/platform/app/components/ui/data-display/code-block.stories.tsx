import type { Meta, StoryObj } from '@storybook/react';

import { Stack } from '../layout/layout';
import { CodeBlock } from './code-block';

const meta: Meta<typeof CodeBlock> = {
  title: 'DataDisplay/CodeBlock',
  component: CodeBlock,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A code block with an optional label and copy-to-clipboard button.

## Usage
\`\`\`tsx
import { CodeBlock } from '@/app/components/ui/data-display/code-block';

<CodeBlock
  label="cURL example"
  copyValue="curl -X POST https://api.example.com/webhook"
  copyLabel="Copy command"
>
  curl -X POST https://api.example.com/webhook
</CodeBlock>
\`\`\`
        `,
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof CodeBlock>;

export const Default: Story = {
  args: {
    children: 'const greeting = "Hello, world!";',
  },
};

export const WithLabel: Story = {
  args: {
    label: 'JavaScript',
    children: 'const greeting = "Hello, world!";',
  },
};

export const WithCopy: Story = {
  args: {
    label: 'cURL example',
    copyValue: 'curl -X POST https://api.example.com/webhook',
    copyLabel: 'Copy command',
    children: 'curl -X POST https://api.example.com/webhook',
  },
};

export const MultiLine: Story = {
  args: {
    label: 'JSON payload',
    copyValue:
      '{\n  "event": "message.created",\n  "data": {\n    "id": "msg_123",\n    "content": "Hello"\n  }\n}',
    copyLabel: 'Copy JSON',
    children:
      '{\n  "event": "message.created",\n  "data": {\n    "id": "msg_123",\n    "content": "Hello"\n  }\n}',
  },
};

export const LongContent: Story = {
  args: {
    label: 'Webhook URL',
    copyValue:
      'https://api.example.com/webhooks/v1/organizations/org_abc123/agents/agent_xyz789/events',
    copyLabel: 'Copy URL',
    children:
      'https://api.example.com/webhooks/v1/organizations/org_abc123/agents/agent_xyz789/events',
  },
  parameters: {
    docs: {
      description: {
        story: 'Long content wraps naturally within the code block.',
      },
    },
  },
};

export const MultipleSections: Story = {
  render: () => (
    <Stack gap={4} className="max-w-lg">
      <CodeBlock
        label="Request"
        copyValue="curl -X POST https://api.example.com/webhook -H 'Content-Type: application/json'"
        copyLabel="Copy request"
      >
        {
          "curl -X POST https://api.example.com/webhook -H 'Content-Type: application/json'"
        }
      </CodeBlock>
      <CodeBlock
        label="Response"
        copyValue='{"status": "ok", "id": "evt_123"}'
        copyLabel="Copy response"
      >
        {'{"status": "ok", "id": "evt_123"}'}
      </CodeBlock>
    </Stack>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Multiple code blocks stacked together for request/response pairs.',
      },
    },
  },
};

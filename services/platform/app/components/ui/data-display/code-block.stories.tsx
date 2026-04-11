import type { Meta, StoryObj } from '@storybook/react';

import { Stack } from '../layout/layout';
import { CodeBlock } from './code-block';

const SAMPLE_JS = `function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log(fibonacci(10));`;

const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Hello</title>
  <style>
    body { font-family: sans-serif; padding: 2rem; }
    .badge { padding: 0.25rem 0.75rem; border-radius: 9999px; }
  </style>
</head>
<body>
  <h1>Hello World</h1>
  <span class="badge">Online</span>
</body>
</html>`;

const SAMPLE_BASH = `#!/bin/bash
set -euo pipefail

for cmd in git node npm; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "Missing: $cmd"
    exit 1
  fi
done

BRANCH=\${1:-main}
git fetch origin "$BRANCH"
npm ci --production
npm run build`;

const SAMPLE_JSON = `{
  "event": "message.created",
  "data": {
    "id": "msg_123",
    "content": "Hello",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}`;

const meta: Meta<typeof CodeBlock> = {
  title: 'DataDisplay/CodeBlock',
  component: CodeBlock,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
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

export const JavaScript: Story = {
  args: {
    label: 'JavaScript',
    language: 'javascript',
    copyValue: SAMPLE_JS,
    copyLabel: 'Copy code',
    children: SAMPLE_JS,
  },
};

export const HTML: Story = {
  args: {
    label: 'HTML',
    language: 'html',
    copyValue: SAMPLE_HTML,
    copyLabel: 'Copy code',
    children: SAMPLE_HTML,
  },
};

export const Bash: Story = {
  args: {
    label: 'Bash',
    language: 'bash',
    copyValue: SAMPLE_BASH,
    copyLabel: 'Copy script',
    children: SAMPLE_BASH,
  },
};

export const JSON: Story = {
  args: {
    label: 'JSON payload',
    language: 'json',
    copyValue: SAMPLE_JSON,
    copyLabel: 'Copy JSON',
    children: SAMPLE_JSON,
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
};

export const MultipleSections: Story = {
  render: () => (
    <Stack gap={4}>
      <CodeBlock
        label="Request"
        language="bash"
        copyValue="curl -X POST https://api.example.com/webhook -H 'Content-Type: application/json'"
        copyLabel="Copy request"
      >
        {
          "curl -X POST https://api.example.com/webhook -H 'Content-Type: application/json'"
        }
      </CodeBlock>
      <CodeBlock
        label="Response"
        language="json"
        copyValue='{"status": "ok", "id": "evt_123"}'
        copyLabel="Copy response"
      >
        {'{"status": "ok", "id": "evt_123"}'}
      </CodeBlock>
    </Stack>
  ),
};

import type { Meta, StoryObj } from '@storybook/react';

import { CodeBlock } from '../code-block';
import { CodeGroup } from './code-group';

const meta = {
  title: 'webui/markdown/CodeGroup',
  component: CodeGroup,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CodeGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

const CURL = `curl -X POST https://api.tale.dev/v1/threads \\
  -H "Authorization: Bearer $TALE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"agentId": "agt_123"}'`;

const TYPESCRIPT = `await fetch('https://api.tale.dev/v1/threads', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.TALE_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ agentId: 'agt_123' }),
});`;

const PYTHON = `import os, requests

requests.post(
    "https://api.tale.dev/v1/threads",
    headers={"Authorization": f"Bearer {os.environ['TALE_API_KEY']}"},
    json={"agentId": "agt_123"},
)`;

export const ApiExamples: Story = {
  render: () => (
    <CodeGroup>
      <CodeBlock code={CURL} language="bash" filename="curl" hideCopy />
      <CodeBlock
        code={TYPESCRIPT}
        language="typescript"
        filename="typescript"
        hideCopy
      />
      <CodeBlock code={PYTHON} language="python" filename="python" hideCopy />
    </CodeGroup>
  ),
};

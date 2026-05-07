import type { Meta, StoryObj } from '@storybook/react';

import { mintlifyComponents } from './components/registry';
import { Markdown } from './markdown';

const meta = {
  title: 'webui/markdown/Markdown',
  component: Markdown,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Markdown>;

export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLE = `# Agent concepts

The mental model behind Tale agents — instructions, knowledge, tools, and models.

## Instructions

Instructions tell the agent **how** to behave. Use sentence case.

## Tools

Tools are how the agent **does things**. Examples include:

- HTTP fetchers
- Vector-store retrievers
- Webhook senders

\`\`\`typescript
import { defineAgent } from '@tale/agent';

export const concierge = defineAgent({
  name: 'concierge',
  model: 'claude-opus-4-7',
});
\`\`\`

> Looking for the API? See [/develop/api-reference](/develop/api-reference).
`;

export const Sample: Story = {
  args: { children: SAMPLE },
};

export const WithMintlifyComponents: Story = {
  args: {
    children: SAMPLE,
    // oxlint-disable-next-line typescript/no-explicit-any -- mintlify keys aren't HTML element tags
    components: mintlifyComponents as any,
  },
};

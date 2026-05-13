import type { Meta, StoryObj } from '@storybook/react';

import { markdownComponents } from './components/registry';
import { Markdown } from './markdown';

const meta = {
  title: 'markdown/Markdown',
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

export const WithMarkdownComponents: Story = {
  args: {
    children: SAMPLE,
    // oxlint-disable-next-line typescript/no-explicit-any -- custom component keys aren't HTML element tags
    components: markdownComponents as any,
  },
};

const TABLE_SAMPLE = `# Tables — sticky thead + row hover

The wrapper is scrollable; the header pins to the top while the body scrolls
underneath. Hover any row to see the tint.

| Region | Q1 | Q2 | Q3 | Q4 | YoY |
| --- | ---: | ---: | ---: | ---: | ---: |
| EU | 1.2k | 1.7k | 2.1k | 2.6k | +18% |
| NA | 2.0k | 2.4k | 2.9k | 3.5k | +9% |
| APAC | 0.6k | 0.9k | 1.2k | 1.5k | +33% |
| LATAM | 0.3k | 0.4k | 0.5k | 0.7k | +24% |
| MEA | 0.2k | 0.3k | 0.4k | 0.5k | +28% |
| Antarctic stations | 0.01k | 0.02k | 0.02k | 0.03k | +50% |
| Maritime fleet | 0.05k | 0.07k | 0.09k | 0.12k | +41% |
| Lunar relay | 0.001k | 0.002k | 0.005k | 0.011k | +900% |
| Mars probe | 0.0001k | 0.0001k | 0.0002k | 0.0005k | +400% |
| Deep space | 0.0001k | 0.0001k | 0.0001k | 0.0001k | 0% |
`;

export const TableWithStickyHeader: Story = {
  args: { children: TABLE_SAMPLE },
};

const ALERTS_SAMPLE = `# GFM alerts → Callouts

> [!NOTE]
> The Markdown component swaps GitHub-style alert blockquotes for callouts.

> [!TIP]
> Use this for small lift-ups that don't warrant a full warning.

> [!IMPORTANT]
> Important context the reader needs before proceeding.

> [!WARNING]
> A risk worth pausing for.

> [!CAUTION]
> Truly destructive — confirm before acting.
`;

export const GfmAlerts: Story = {
  args: { children: ALERTS_SAMPLE },
};

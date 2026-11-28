import type { Meta, StoryObj } from '@storybook/react';

import { Mermaid } from './mermaid';

const meta = {
  title: 'markdown/Mermaid',
  component: Mermaid,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Mermaid>;

export default meta;
type Story = StoryObj<typeof meta>;

const FLOWCHART = `flowchart LR
    A[Browser] --> B[TanStack Start]
    B --> C[Convex]
    C --> D[RAG]
    C --> E[Agent]
`;

const SEQUENCE = `sequenceDiagram
    participant U as User
    participant A as Agent
    participant K as Knowledge
    U->>A: ask
    A->>K: retrieve
    K-->>A: context
    A-->>U: answer
`;

const STATE_DIAGRAM = `stateDiagram-v2
    [*] --> Idle
    Idle --> Streaming
    Streaming --> Idle
    Streaming --> Error
    Error --> Idle
`;

const PIE = `pie title Cache hit ratio
    "Hit" : 78
    "Miss" : 22
`;

const BROKEN = `flowchart TD
    this is not valid mermaid syntax!!
`;

export const Flowchart: Story = {
  args: { chart: FLOWCHART },
};

export const Sequence: Story = {
  args: { chart: SEQUENCE },
};

export const StateDiagram: Story = {
  args: { chart: STATE_DIAGRAM },
};

export const PieChart: Story = {
  args: { chart: PIE },
};

export const ParseError: Story = {
  args: { chart: BROKEN },
};

import type { Meta, StoryObj } from '@storybook/react';

import { CodeBlock } from './code-block';

const meta = {
  title: 'webui/markdown/CodeBlock',
  component: CodeBlock,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

const TS_SAMPLE = `import { highlightCode } from '@tale/webui/markdown/shiki';

const result = await highlightCode(
  'console.log("hello tale");',
  'typescript',
  'light',
);
`;

const BASH_SAMPLE = `# install dependencies
bun install

# start the docs site on :3002
bun run --filter @tale/docs dev
`;

export const TypeScript: Story = {
  args: {
    code: TS_SAMPLE,
    language: 'typescript',
    filename: 'highlight.ts',
  },
};

export const Bash: Story = {
  args: {
    code: BASH_SAMPLE,
    language: 'bash',
    filename: 'README.md · quickstart',
  },
};

export const NoCopy: Story = {
  args: {
    code: TS_SAMPLE,
    language: 'typescript',
    hideCopy: true,
  },
};

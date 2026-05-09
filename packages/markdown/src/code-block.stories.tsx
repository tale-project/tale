import type { Meta, StoryObj } from '@storybook/react';

import { CodeBlock } from './code-block';

const meta = {
  title: 'markdown/CodeBlock',
  component: CodeBlock,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

const TS_SAMPLE = `import { highlightCode } from '@tale/markdown/shiki';

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

const DIFF_SAMPLE = `diff --git a/migration.sql b/migration.sql
@@ -10,7 +10,7 @@
   ALTER TABLE customers
-    ADD COLUMN email TEXT NOT NULL;
+    ADD COLUMN email TEXT NOT NULL DEFAULT '';
   COMMIT;
`;

export const Diff: Story = {
  args: {
    code: DIFF_SAMPLE,
    language: 'diff',
    filename: 'migration.diff',
  },
};

const LONG_SAMPLE = `function highlight(code, language) {
  // Hover any line to see the row-tint effect.
  if (!code) return '';
  const tokens = tokenize(code, language);
  return tokens
    .map((token) => renderToken(token))
    .join('');
}

function tokenize(code, language) {
  return [];
}

function renderToken(token) {
  return token.value;
}
`;

export const RowHover: Story = {
  args: {
    code: LONG_SAMPLE,
    language: 'javascript',
    filename: 'highlight.js — hover the lines',
  },
};

const TRAILING_NEWLINE_SAMPLE = `# Five lines, exact line numbers
docker pull ghcr.io/tale-project/tale/tale-platform:1.2.0

# Latest release
docker pull ghcr.io/tale-project/tale/tale-platform:latest
`;

// Regression story for the line-number bug: trailing newlines used to
// produce a Shiki line that the gutter never numbered, so the last visible
// row sat without an index. The screenshot in #1691-issue captures the
// exact state. Both lines and numbers must stay in lockstep.
export const LineNumbersWithTrailingNewline: Story = {
  args: {
    code: TRAILING_NEWLINE_SAMPLE,
    language: 'bash',
    filename: 'docker-pull.sh',
  },
};

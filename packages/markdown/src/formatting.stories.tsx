import type { Meta, StoryObj } from '@storybook/react';

import { Markdown } from './markdown';

const meta = {
  title: 'markdown/Samples/Formatting',
  component: Markdown,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Markdown>;

export default meta;
type Story = StoryObj<typeof meta>;

const INLINE = `# Inline formatting

Body prose with **bold**, _italic_, ~~strikethrough~~, and \`inline code\`.
You can [link to docs](https://docs.tale.dev) or to a heading on the same
page like [#getting-started](#getting-started). External links open in a new
tab; internal anchor links scroll smoothly.

Combine **_bold italic_** or **\`bold code\`** when emphasis stacks. The
muted text-fg-muted token keeps body prose calm so highlights pop.

You can use a thematic break to separate sections:

---

After the rule, the next block continues at full body weight.
`;

const LISTS = `# Lists

## Bullet list

- First item
- Second item
  - Nested item
  - Another nested
    - Three deep
- Third item

## Ordered list

1. Plan
2. Build
3. Ship
   1. Open PR
   2. Address review
   3. Merge

## Task list (GFM)

- [x] Migrate webui markdown
- [x] Stream chat into shared package
- [ ] Refactor legal-page
- [ ] Recreate Pencil designs
`;

const QUOTES = `# Block quotes

> A short quotation. The blockquote rail picks up the accent token.
> Multiple lines wrap into one quote block.

> Nested quotes work too —
>
> > like this — nested level two
> >
> > > and even three levels deep, though that's rare in real prose.

> A quote followed by **rich** _formatting_ and \`code\` still renders.
`;

export const InlineElements: Story = {
  args: { children: INLINE },
};

export const Lists: Story = {
  args: { children: LISTS },
};

export const Blockquotes: Story = {
  args: { children: QUOTES },
};

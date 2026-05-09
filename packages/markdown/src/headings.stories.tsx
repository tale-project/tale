import type { Meta, StoryObj } from '@storybook/react';

import { Markdown } from './markdown';

const meta = {
  title: 'markdown/Samples/Headings',
  component: Markdown,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Markdown>;

export default meta;
type Story = StoryObj<typeof meta>;

const HEADINGS = `# Heading 1 — page title

Body paragraph after a top-level heading. Use one h1 per page.

## Heading 2 — section

Body paragraph after a section heading. Headings cascade down by importance.

### Heading 3 — subsection

Body paragraph after a subsection heading.

#### Heading 4 — subsubsection

Body paragraph after a deep subsection.

##### Heading 5

Body paragraph.

###### Heading 6

Body paragraph.
`;

const HEADING_HIERARCHY = `# Top-level page

## First section

### A nested concept

Some prose under the nested concept.

### Another nested concept

More prose.

## Second section

### Yet another concept

Final paragraph.
`;

export const AllLevels: Story = {
  args: { children: HEADINGS },
};

export const Hierarchy: Story = {
  args: { children: HEADING_HIERARCHY },
};

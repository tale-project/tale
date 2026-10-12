import type { Meta, StoryObj } from '@storybook/react';

import { Callout } from './callout';

const meta = {
  title: 'markdown/Callout',
  component: Callout,
  tags: ['autodocs'],
  argTypes: {
    tone: {
      control: { type: 'inline-radio' },
      options: ['note', 'tip', 'info', 'warning', 'danger', 'check'],
    },
  },
} satisfies Meta<typeof Callout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Note: Story = {
  args: {
    tone: 'note',
    children:
      'Notes capture context that the reader should be aware of but isn’t critical to the task at hand.',
  },
};

export const Tip: Story = {
  args: {
    tone: 'tip',
    children:
      'Tips offer optional ways to improve a workflow once the reader has the basics down.',
  },
};

export const Info: Story = {
  args: {
    tone: 'info',
    children:
      'Info callouts highlight references or background that the reader may want to follow.',
  },
};

export const Warning: Story = {
  args: {
    tone: 'warning',
    children:
      'Warnings flag actions that can cause data loss, downtime, or unexpected billing.',
  },
};

export const Danger: Story = {
  args: {
    tone: 'danger',
    children:
      'Danger callouts mark destructive operations the reader should not run without understanding the consequences.',
  },
};

export const Check: Story = {
  args: {
    tone: 'check',
    children:
      'Check callouts confirm a successful state — used after a step the reader has just completed.',
  },
};

/**
 * Verifies that links, inline code, and emphasised text inside a callout
 * inherit the strong foreground tone instead of the muted body colour
 * react-markdown applies to paragraphs by default.
 */
export const WithEmbeddedMarkdown: Story = {
  args: {
    tone: 'info',
    children: (
      <p>
        Use the <code>tale init</code> command to scaffold a workspace, then
        review the <a href="#setup">setup checklist</a> before inviting{' '}
        <strong>teammates</strong>.
      </p>
    ),
  },
};

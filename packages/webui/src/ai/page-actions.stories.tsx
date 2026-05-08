import type { Meta, StoryObj } from '@storybook/react';

import { PageActions } from './page-actions';

const meta = {
  title: 'webui/ai/PageActions',
  component: PageActions,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof PageActions>;

export default meta;
type Story = StoryObj<typeof meta>;

const PAGE_URL = 'https://docs.tale.dev/platform/agents/concepts';
const MARKDOWN_URL = `${PAGE_URL}.md`;

export const Default: Story = {
  args: {
    pageUrl: PAGE_URL,
    markdownUrl: MARKDOWN_URL,
    markdown: '# Agent concepts\n\nThe mental model behind Tale agents.',
  },
};

export const WithoutCopy: Story = {
  args: {
    pageUrl: PAGE_URL,
    markdownUrl: MARKDOWN_URL,
    markdown: null,
  },
};

export const TranslatedLabels: Story = {
  args: {
    pageUrl: PAGE_URL,
    markdownUrl: MARKDOWN_URL,
    markdown: '# Konzept\n\nDas mentale Modell hinter Tale Agents.',
    labels: {
      copyPage: 'Seite kopieren',
      copied: 'Kopiert',
      viewMarkdown: 'Als Markdown ansehen',
      openIn: 'Öffnen in',
      openChatGpt: 'Öffnen in ChatGPT',
      openClaude: 'Öffnen in Claude',
      openCursor: 'Öffnen in Cursor',
    },
  },
};

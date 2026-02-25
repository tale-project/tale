import type { Meta, StoryObj } from '@storybook/react';

import { InlineCode } from './inline-code';

const meta: Meta<typeof InlineCode> = {
  title: 'Data Display/InlineCode',
  component: InlineCode,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Inline code display for variables, markers, and short code snippets within text.

## Usage

\`\`\`tsx
import { InlineCode } from '@/app/components/ui/data-display/inline-code';

<p>Use the <InlineCode>api_key</InlineCode> from your settings.</p>
\`\`\`
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof InlineCode>;

export const Default: Story = {
  render: () => <InlineCode>console.log</InlineCode>,
};

export const InParagraph: Story = {
  render: () => (
    <p className="text-sm">
      Use the <InlineCode>api_key</InlineCode> from your settings to
      authenticate.
    </p>
  ),
};

export const TemplateVariable: Story = {
  render: () => (
    <p className="text-sm">
      Available variables: <InlineCode>{'{{current_time}}'}</InlineCode>,{' '}
      <InlineCode>{'{{organization.name}}'}</InlineCode>, and{' '}
      <InlineCode>{'{{user.name}}'}</InlineCode>.
    </p>
  ),
};

export const SectionMarker: Story = {
  render: () => (
    <p className="text-sm">
      The agent uses markers like <InlineCode>[[CONCLUSION]]</InlineCode> and{' '}
      <InlineCode>[[NEXT_STEPS]]</InlineCode> to structure responses.
    </p>
  ),
};

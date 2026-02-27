import type { Meta, StoryObj } from '@storybook/react';

import { Text } from './text';

const meta: Meta<typeof Text> = {
  title: 'Typography/Text',
  component: Text,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Semantic text component with predefined style variants for consistent typography.

## Variants

| Variant | Styles | Use case |
|---------|--------|----------|
| \`body\` | text-sm text-foreground | Standard body text |
| \`body-sm\` | text-xs text-foreground | Small body text |
| \`muted\` | text-sm text-muted-foreground | Descriptions, helper text |
| \`caption\` | text-xs text-muted-foreground | Metadata, timestamps |
| \`label\` | text-sm font-medium | Form labels, field names |
| \`label-sm\` | text-xs font-medium | Small labels |
| \`code\` | text-xs font-mono | Code, API keys |
| \`error\` | text-sm text-destructive | Error messages |
| \`error-sm\` | text-xs text-destructive font-medium | Small error text |
| \`success\` | text-sm font-medium text-success | Success messages |

## Usage

\`\`\`tsx
import { Text } from '@/app/components/ui/typography/text';

<Text variant="muted">Description text</Text>
<Text as="span" variant="caption">12 items</Text>
<Text as="span" variant="code">api_key_123</Text>
\`\`\`
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Text>;

export const Default: Story = {
  args: { children: 'Default body text' },
};

export const AllVariants: Story = {
  render: () => (
    <div className="space-y-3">
      <Text variant="body">body — Standard body text</Text>
      <Text variant="body-sm">body-sm — Small body text</Text>
      <Text variant="muted">muted — Description and helper text</Text>
      <Text variant="caption">caption — Metadata and timestamps</Text>
      <Text variant="label">label — Form labels and field names</Text>
      <Text variant="label-sm">label-sm — Small labels</Text>
      <Text variant="code">code — API keys and code snippets</Text>
      <Text variant="error">error — Error messages</Text>
      <Text variant="error-sm">error-sm — Small error text</Text>
      <Text variant="success">success — Success messages</Text>
    </div>
  ),
};

export const MutedDescription: Story = {
  args: {
    variant: 'muted',
    children:
      'This is a muted description commonly used for helper text and secondary information.',
  },
};

export const InlineSpan: Story = {
  render: () => (
    <Text>
      Status:{' '}
      <Text as="span" variant="label">
        Active
      </Text>
    </Text>
  ),
};

export const CodeText: Story = {
  args: { as: 'span', variant: 'code', children: 'sk_live_abc123def456' },
};

export const Truncated: Story = {
  args: {
    truncate: true,
    children:
      'This is a very long text that will be truncated with an ellipsis',
  },
  render: (args) => (
    <div className="w-48">
      <Text {...args} />
    </div>
  ),
};

export const CenterAligned: Story = {
  args: { variant: 'muted', align: 'center', children: 'No items found' },
};

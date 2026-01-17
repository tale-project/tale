import type { Meta, StoryObj } from '@storybook/react';
import { CopyableField } from './copyable-field';

const meta: Meta<typeof CopyableField> = {
  title: 'Data Display/CopyableField',
  component: CopyableField,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Components for displaying copyable values with a copy-to-clipboard button.

## Usage
\`\`\`tsx
import { CopyableField } from '@/app/components/ui/data-display/copyable-field';

<CopyableField value="abc123def456" label="API Key" />
\`\`\`

## Accessibility
- Copy button has aria-label
- Screen reader announces when copied
- Icons are decorative (aria-hidden)
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof CopyableField>;

export const Default: Story = {
  args: {
    value: 'sk_live_abc123def456ghi789',
  },
};

export const WithLabel: Story = {
  args: {
    value: 'sk_live_abc123def456ghi789',
    label: 'API Key',
  },
};

export const NonMonospace: Story = {
  args: {
    value: 'hello@example.com',
    label: 'Email',
    mono: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Use mono={false} for non-code values like emails.',
      },
    },
  },
};

export const LongValue: Story = {
  args: {
    value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ',
    label: 'JWT Token',
  },
  parameters: {
    docs: {
      description: {
        story: 'Long values are displayed with text overflow.',
      },
    },
  },
};

export const MultipleFields: Story = {
  render: () => (
    <div className="space-y-4 w-96">
      <CopyableField value="proj_abc123" label="Project ID" />
      <CopyableField value="sk_live_secret_key_here" label="Secret Key" />
      <CopyableField value="https://api.example.com/v1" label="API Endpoint" mono={false} />
    </div>
  ),
};


export const InCard: Story = {
  render: () => (
    <div className="p-4 border rounded-lg space-y-4 w-96">
      <h3 className="font-semibold">API Credentials</h3>
      <p className="text-sm text-muted-foreground">
        Use these credentials to authenticate API requests.
      </p>
      <CopyableField value="pk_live_public_key" label="Public Key" />
      <CopyableField value="sk_live_secret_key" label="Secret Key" />
      <p className="text-xs text-muted-foreground">
        Keep your secret key safe. Never share it publicly.
      </p>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Copyable fields in a card layout for credentials.',
      },
    },
  },
};

export const WebhookUrl: Story = {
  args: {
    value: 'https://api.example.com/webhooks/abc123',
    label: 'Webhook URL',
    mono: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Copyable field for webhook URLs.',
      },
    },
  },
};

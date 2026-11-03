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
import { CopyableField } from '@tale/ui/copyable-field';

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
    value: 'example_api_key_abc123def456',
  },
};

export const WithLabel: Story = {
  args: {
    value: 'example_api_key_abc123def456',
    label: 'API key',
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
    value:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ',
    label: 'JWT token',
  },
  parameters: {
    docs: {
      description: {
        story: 'Long values are displayed with text overflow.',
      },
    },
  },
};

export const Masked: Story = {
  args: {
    value: 'correct horse battery staple',
    label: 'Password',
    mono: false,
    masked: true,
    revealLabels: { show: 'Show Password', hide: 'Hide Password' },
    copyAriaLabel: 'Copy Password',
    copiedLabel: 'Password copied',
  },
  parameters: {
    docs: {
      description: {
        story:
          'A secret: dots stand for it until the eye shows it, and copying never shows it. While it is masked the value is nowhere in the page. The pill holds two buttons, so it is no button itself.',
      },
    },
  },
};

export const Wrapped: Story = {
  args: {
    value: 'Network: Studio-5G\nGuests use the guest network.',
    label: 'Note',
    mono: false,
    wrap: true,
    copyAriaLabel: 'Copy Note',
  },
  parameters: {
    docs: {
      description: {
        story:
          "A value that is read, not just copied: shown whole, wrapped at the pill's edge, with its line breaks kept.",
      },
    },
  },
};

export const SecretsOfASecret: Story = {
  render: () => (
    <div className="w-96 space-y-4">
      {[
        ['Website', 'https://shop.example', false],
        ['Username', 'jane@example.com', false],
        ['Password', 'sample-password', true],
      ].map(([label, value, masked]) => (
        <CopyableField
          key={String(label)}
          label={String(label)}
          value={String(value)}
          mono={false}
          wrap
          masked={masked === true}
          copyAriaLabel={`Copy ${String(label)}`}
          revealLabels={{
            show: `Show ${String(label)}`,
            hide: `Hide ${String(label)}`,
          }}
        />
      ))}
    </div>
  ),
};

export const MultipleFields: Story = {
  render: () => (
    <div className="w-96 space-y-4">
      <CopyableField value="proj_abc123" label="Project ID" />
      <CopyableField value="example_secret_token_abc123" label="Secret key" />
      <CopyableField
        value="https://api.example.com/v1"
        label="API endpoint"
        mono={false}
      />
    </div>
  ),
};

export const InCard: Story = {
  render: () => (
    <div className="w-96 space-y-4 rounded-lg border p-4">
      <h3 className="font-semibold">API credentials</h3>
      <p className="text-muted-foreground text-sm">
        Use these credentials to authenticate API requests.
      </p>
      <CopyableField value="pk_example_public_key" label="Public key" />
      <CopyableField value="example_secret_key" label="Secret key" />
      <p className="text-muted-foreground text-xs">
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

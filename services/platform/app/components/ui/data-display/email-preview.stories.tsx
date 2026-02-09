import type { Meta, StoryObj } from '@storybook/react';

import { EmailPreview } from './email-preview';

const meta: Meta<typeof EmailPreview> = {
  title: 'Data Display/EmailPreview',
  component: EmailPreview,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A secure HTML email preview component with sanitization.

## Usage
\`\`\`tsx
import { EmailPreview } from '@/app/components/ui/data-display/email-preview';

<EmailPreview html="<p>Hello <strong>World</strong></p>" />
\`\`\`

## Features
- HTML sanitization with DOMPurify
- Safe CSS property allowlist
- Automatic link safety (target="_blank", rel="noopener noreferrer")
- Quoted/forwarded content collapsing
- Responsive images
        `,
      },
    },
  },
  argTypes: {
    html: {
      control: 'text',
      description: 'HTML content to render',
    },
  },
};

export default meta;
type Story = StoryObj<typeof EmailPreview>;

export const SimpleText: Story = {
  args: {
    html: '<p>Hello! This is a simple email message.</p><p>Best regards,<br>John</p>',
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl overflow-hidden rounded-lg border">
        <Story />
      </div>
    ),
  ],
};

export const RichFormatting: Story = {
  args: {
    html: `
      <h1>Welcome to Our Newsletter</h1>
      <p>Dear <strong>valued customer</strong>,</p>
      <p>We're excited to share some <em>important updates</em> with you:</p>
      <ul>
        <li>New feature release</li>
        <li>Improved performance</li>
        <li>Bug fixes</li>
      </ul>
      <p>Visit our <a href="https://example.com">website</a> for more details.</p>
      <blockquote>
        "Great things are coming!" - Our CEO
      </blockquote>
    `,
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl overflow-hidden rounded-lg border">
        <Story />
      </div>
    ),
  ],
};

export const WithTable: Story = {
  args: {
    html: `
      <h2>Your Order Summary</h2>
      <table border="1" cellpadding="8" cellspacing="0" style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background-color: #f5f5f5;">
            <th>Item</th>
            <th>Quantity</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Product A</td>
            <td>2</td>
            <td>$20.00</td>
          </tr>
          <tr>
            <td>Product B</td>
            <td>1</td>
            <td>$35.00</td>
          </tr>
          <tr style="font-weight: bold;">
            <td colspan="2">Total</td>
            <td>$75.00</td>
          </tr>
        </tbody>
      </table>
    `,
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl overflow-hidden rounded-lg border">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Email with table layout (common in transactional emails).',
      },
    },
  },
};

export const WithQuotedContent: Story = {
  args: {
    html: `
      <p>Thanks for the update! I'll review it today.</p>
      <p>Best,<br>Jane</p>

      On January 15, 2024, John wrote:
      <blockquote>
        <p>Hi Jane,</p>
        <p>Please find the attached report.</p>
        <p>Regards,<br>John</p>
      </blockquote>
    `,
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl overflow-hidden rounded-lg border">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Email with quoted/replied content that can be toggled.',
      },
    },
  },
};

export const WithImage: Story = {
  args: {
    html: `
      <div style="text-align: center;">
        <img src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=200&fit=crop" alt="Mountain landscape" style="max-width: 100%; border-radius: 8px;" />
        <p style="color: #666; font-size: 14px;">Beautiful mountain scenery</p>
      </div>
      <p>Check out this amazing view from our recent trip!</p>
    `,
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl overflow-hidden rounded-lg border">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Email with embedded image (responsive).',
      },
    },
  },
};

export const PlainTextStyle: Story = {
  args: {
    html: `
      <pre style="font-family: monospace; white-space: pre-wrap;">
Hi there,

This is a plain text style email.
No fancy formatting here.

- Point 1
- Point 2
- Point 3

Cheers,
The Team
      </pre>
    `,
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl overflow-hidden rounded-lg border">
        <Story />
      </div>
    ),
  ],
};

export const Newsletter: Story = {
  args: {
    html: `
      <div style="max-width: 600px; margin: 0 auto;">
        <div style="background-color: #4F46E5; color: white; padding: 24px; text-align: center;">
          <h1 style="margin: 0; color: white;">Weekly Digest</h1>
          <p style="margin: 8px 0 0 0; opacity: 0.9; color: white;">January 15, 2024</p>
        </div>

        <div style="padding: 24px;">
          <h2>Top Stories This Week</h2>

          <div style="margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid #eee;">
            <h3 style="margin: 0 0 8px 0;">New Product Launch</h3>
            <p style="color: #666; margin: 0;">We're excited to announce our latest innovation...</p>
            <a href="https://example.com" style="color: #4F46E5;">Read more →</a>
          </div>

          <div style="margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid #eee;">
            <h3 style="margin: 0 0 8px 0;">Community Spotlight</h3>
            <p style="color: #666; margin: 0;">Meet our featured community member of the month...</p>
            <a href="https://example.com" style="color: #4F46E5;">Read more →</a>
          </div>
        </div>

        <div style="background-color: #f5f5f5; padding: 16px; text-align: center; font-size: 12px; color: #666;">
          <p style="margin: 0;">You're receiving this because you subscribed to our newsletter.</p>
          <p style="margin: 8px 0 0 0;"><a href="https://example.com/unsubscribe" style="color: #666;">Unsubscribe</a></p>
        </div>
      </div>
    `,
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl overflow-hidden rounded-lg border">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Full newsletter email layout example.',
      },
    },
  },
};

export const CustomStyling: Story = {
  args: {
    html: '<p>Email content</p>',
    className: 'bg-blue-50',
    style: { minHeight: '200px' },
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl overflow-hidden rounded-lg border">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Custom className and style props for container customization.',
      },
    },
  },
};

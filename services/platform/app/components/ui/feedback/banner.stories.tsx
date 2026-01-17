import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Info as InfoIcon, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { Banner } from './banner';

const meta: Meta<typeof Banner> = {
  title: 'Feedback/Banner',
  component: Banner,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A banner component for displaying important messages with various severity levels.

## Usage
\`\`\`tsx
import { Banner } from '@/app/components/ui/feedback/banner';
import { Info } from 'lucide-react';

<Banner
  variant="info"
  message="This is an informational message."
  icon={InfoIcon}
  dismissible
  onClose={() => {}}
/>
\`\`\`

## Accessibility
- Uses role="alert" for announcements
- Dismiss button has proper aria-label
- Icons are decorative (aria-hidden)
        `,
      },
    },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['info', 'warning', 'success', 'error'],
    },
    dismissible: {
      control: 'boolean',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Banner>;

export const Info: Story = {
  args: {
    variant: 'info',
    message: 'A new version of the application is available.',
    icon: InfoIcon,
    dismissible: true,
  },
};

export const Warning: Story = {
  args: {
    variant: 'warning',
    message: 'Your subscription will expire in 3 days.',
    icon: AlertTriangle,
    dismissible: true,
  },
};

export const Success: Story = {
  args: {
    variant: 'success',
    message: 'Your changes have been saved successfully.',
    icon: CheckCircle,
    dismissible: true,
  },
};

export const Error: Story = {
  args: {
    variant: 'error',
    message: 'Failed to connect to the server. Please try again.',
    icon: XCircle,
    dismissible: true,
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="space-y-4">
      <Banner
        variant="info"
        message="This is an informational banner."
        icon={InfoIcon}
      />
      <Banner
        variant="warning"
        message="This is a warning banner."
        icon={AlertTriangle}
      />
      <Banner
        variant="success"
        message="This is a success banner."
        icon={CheckCircle}
      />
      <Banner
        variant="error"
        message="This is an error banner."
        icon={XCircle}
      />
    </div>
  ),
};

export const WithoutIcon: Story = {
  args: {
    variant: 'info',
    message: 'This banner has no icon.',
    dismissible: true,
  },
};

export const NonDismissible: Story = {
  args: {
    variant: 'warning',
    message: 'This banner cannot be dismissed.',
    icon: AlertTriangle,
    dismissible: false,
  },
};

export const Dismissible: Story = {
  render: function Render() {
    const [hidden, setHidden] = useState(false);

    return (
      <div className="space-y-4">
        <Banner
          variant="info"
          message="Click the X button to dismiss this banner."
          icon={InfoIcon}
          dismissible
          isHidden={hidden}
          onClose={() => setHidden(true)}
        />
        {hidden && (
          <button
            onClick={() => setHidden(false)}
            className="text-sm text-primary hover:underline"
          >
            Show banner again
          </button>
        )}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Banners can be dismissed by clicking the close button.',
      },
    },
  },
};

export const LongMessage: Story = {
  args: {
    variant: 'warning',
    message:
      'This is a longer message that demonstrates how the banner handles multiple lines of text. The banner will expand to accommodate the content while maintaining proper alignment of the icon and dismiss button.',
    icon: AlertTriangle,
    dismissible: true,
  },
};

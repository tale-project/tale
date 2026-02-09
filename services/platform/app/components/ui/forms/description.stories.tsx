import type { Meta, StoryObj } from '@storybook/react';

import { Description } from './description';

const meta: Meta<typeof Description> = {
  title: 'Forms/Description',
  component: Description,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A text component for descriptions and helper text in forms.

## Usage
\`\`\`tsx
import { Description } from '@/app/components/ui/forms/description';

<Description>
  Enter your email address to receive updates.
</Description>

// Without muted styling
<Description muted={false}>
  Important information here.
</Description>
\`\`\`

## Use Cases
- Form field helper text
- Section descriptions
- Informational paragraphs
        `,
      },
    },
  },
  argTypes: {
    muted: {
      control: 'boolean',
      description: 'Display with muted/secondary styling',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Description>;

export const Default: Story = {
  args: {
    children:
      'Enter your email address to receive important updates and notifications.',
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};

export const NotMuted: Story = {
  args: {
    children: 'This is important information that should stand out.',
    muted: false,
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Without muted styling for emphasis.',
      },
    },
  },
};

export const WithFormField: Story = {
  render: () => (
    <div className="w-80 space-y-2">
      <label htmlFor="password" className="text-sm font-medium">
        Password
      </label>
      <input
        id="password"
        type="password"
        className="w-full rounded-md border px-3 py-2 text-sm"
        placeholder="Enter password"
      />
      <Description>
        Must be at least 8 characters with one uppercase letter and one number.
      </Description>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Helper text below a form field.',
      },
    },
  },
};

export const LongDescription: Story = {
  args: {
    children: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod
    tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
    nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.`,
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
};

export const SectionDescription: Story = {
  render: () => (
    <div className="w-96 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Account Settings</h2>
        <Description>
          Manage your account preferences and security settings. Changes may
          take a few minutes to take effect.
        </Description>
      </div>
      <div className="bg-muted/30 rounded-lg border p-4">
        <p className="text-sm">Settings content goes here...</p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Description text below a section heading.',
      },
    },
  },
};

export const WithLink: Story = {
  render: () => (
    <div className="w-80">
      <Description>
        By continuing, you agree to our{' '}
        <a href="/terms" className="text-primary hover:underline">
          Terms of Service
        </a>{' '}
        and{' '}
        <a href="/privacy" className="text-primary hover:underline">
          Privacy Policy
        </a>
        .
      </Description>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Description with embedded links.',
      },
    },
  },
};

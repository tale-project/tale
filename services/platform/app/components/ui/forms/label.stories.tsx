import type { Meta, StoryObj } from '@storybook/react';

import { Label } from './label';

const meta: Meta<typeof Label> = {
  title: 'Forms/Label',
  component: Label,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
An accessible form label component based on Radix UI.

## Usage
\`\`\`tsx
import { Label } from '@/app/components/ui/forms/label';

<Label htmlFor="email">Email address</Label>
<input id="email" type="email" />

// With required indicator
<Label htmlFor="name" required>Full name</Label>
\`\`\`

## Accessibility
- Associates with form inputs via \`htmlFor\`
- Required indicator includes aria-label for screen readers
- Supports error state styling
        `,
      },
    },
  },
  argTypes: {
    required: {
      control: 'boolean',
      description: 'Show required indicator (*)',
    },
    error: {
      control: 'boolean',
      description: 'Show error state styling',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Label>;

export const Default: Story = {
  args: {
    children: 'Email address',
  },
};

export const Required: Story = {
  args: {
    children: 'Full name',
    required: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Required fields show a red asterisk indicator.',
      },
    },
  },
};

export const ErrorState: Story = {
  args: {
    children: 'Email address',
    error: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Error state shows the label in destructive color.',
      },
    },
  },
};

export const WithInput: Story = {
  render: () => (
    <div className="w-64 space-y-2">
      <Label htmlFor="email-example">Email address</Label>
      <input
        id="email-example"
        type="email"
        placeholder="Enter your email"
        className="w-full rounded-md border px-3 py-2 text-sm"
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Label associated with an input via htmlFor.',
      },
    },
  },
};

export const RequiredWithInput: Story = {
  render: () => (
    <div className="w-64 space-y-2">
      <Label htmlFor="name-example" required>
        Full name
      </Label>
      <input
        id="name-example"
        type="text"
        placeholder="Enter your name"
        className="w-full rounded-md border px-3 py-2 text-sm"
        required
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Required label with associated input.',
      },
    },
  },
};

export const ErrorWithInput: Story = {
  render: () => (
    <div className="w-64 space-y-2">
      <Label htmlFor="invalid-email" required error>
        Email address
      </Label>
      <input
        id="invalid-email"
        type="email"
        defaultValue="invalid-email"
        className="w-full rounded-md border border-red-500 px-3 py-2 text-sm"
        aria-invalid="true"
      />
      <p className="text-destructive text-xs">
        Please enter a valid email address
      </p>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Error state with invalid input.',
      },
    },
  },
};

export const FormGroup: Story = {
  render: () => (
    <div className="w-64 space-y-4">
      <div className="space-y-2">
        <Label htmlFor="firstname" required>
          First name
        </Label>
        <input
          id="firstname"
          type="text"
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="lastname" required>
          Last name
        </Label>
        <input
          id="lastname"
          type="text"
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bio">Bio</Label>
        <input
          id="bio"
          type="text"
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Multiple labels in a form layout.',
      },
    },
  },
};

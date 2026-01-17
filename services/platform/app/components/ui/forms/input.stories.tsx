import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { Input } from './input';

const meta: Meta<typeof Input> = {
  title: 'Forms/Input',
  component: Input,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A flexible input component with built-in label, error handling, and password toggle.

## Usage
\`\`\`tsx
import { Input } from './input';

<Input label="Email" type="email" placeholder="Enter email" />
<Input type="password" label="Password" errorMessage="Invalid password" />
\`\`\`

## Accessibility
- Labels are properly associated via \`htmlFor\`
- Error messages use \`aria-describedby\` and \`role="alert"\`
- Password toggle has \`aria-pressed\` state
- Shake animation on error provides visual feedback
        `,
      },
    },
  },
  argTypes: {
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg'],
      description: 'Input size variant',
    },
    type: {
      control: 'select',
      options: ['text', 'email', 'password', 'number', 'tel', 'url'],
      description: 'HTML input type',
    },
    label: {
      control: 'text',
      description: 'Label text displayed above the input',
    },
    errorMessage: {
      control: 'text',
      description: 'Error message displayed below the input',
    },
    required: {
      control: 'boolean',
      description: 'Marks the field as required',
    },
    disabled: {
      control: 'boolean',
      description: 'Disables the input',
    },
    placeholder: {
      control: 'text',
      description: 'Placeholder text',
    },
  },
  args: {
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: {
    placeholder: 'Enter text...',
  },
};

export const WithLabel: Story = {
  args: {
    label: 'Email address',
    type: 'email',
    placeholder: 'name@example.com',
  },
};

export const Required: Story = {
  args: {
    label: 'Username',
    required: true,
    placeholder: 'Enter username',
  },
};

export const WithError: Story = {
  args: {
    label: 'Email',
    type: 'email',
    defaultValue: 'invalid-email',
    errorMessage: 'Please enter a valid email address',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Error state with shake animation and accessible error message.',
      },
    },
  },
};

export const Password: Story = {
  args: {
    label: 'Password',
    type: 'password',
    placeholder: 'Enter password',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Password input with toggle visibility button. The toggle has proper ARIA attributes.',
      },
    },
  },
};

export const PasswordWithError: Story = {
  args: {
    label: 'Password',
    type: 'password',
    defaultValue: '123',
    errorMessage: 'Password must be at least 8 characters',
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Input size="sm" label="Small" placeholder="Small input" />
      <Input size="default" label="Default" placeholder="Default input" />
      <Input size="lg" label="Large" placeholder="Large input" />
    </div>
  ),
};

export const Disabled: Story = {
  args: {
    label: 'Disabled field',
    disabled: true,
    defaultValue: 'Cannot edit this',
  },
};

export const FormExample: Story = {
  render: () => (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => e.preventDefault()}
    >
      <Input label="Full name" required placeholder="John Doe" />
      <Input
        label="Email"
        type="email"
        required
        placeholder="john@example.com"
      />
      <Input label="Password" type="password" required />
      <Input label="Phone (optional)" type="tel" placeholder="+1 (555) 000-0000" />
    </form>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Example form layout with multiple input types.',
      },
    },
  },
};

import type { Meta, StoryObj } from '@storybook/react';

import { useState } from 'react';
import { fn } from 'storybook/test';
import { z } from 'zod';

import { JsonInput } from './json-input';

const meta: Meta<typeof JsonInput> = {
  title: 'Forms/JsonInput',
  component: JsonInput,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
An editable JSON input with syntax highlighting and schema validation.

## Usage
\`\`\`tsx
import { JsonInput } from '@/app/components/ui/forms/json-input';

<JsonInput
  value='{"key": "value"}'
  onChange={(value) => console.log(value)}
  label="Configuration"
/>
\`\`\`

## Features
- Visual JSON tree view with syntax highlighting
- Source code editing mode
- Schema validation with Zod
- Inline editing in tree view
- Keyboard shortcuts (Ctrl+Enter to save, Escape to cancel)
        `,
      },
    },
  },
  argTypes: {
    disabled: {
      control: 'boolean',
      description: 'Disable editing',
    },
    label: {
      control: 'text',
      description: 'Label text',
    },
    description: {
      control: 'text',
      description: 'Help text below the input',
    },
    indentWidth: {
      control: { type: 'number', min: 1, max: 8 },
      description: 'JSON indentation width',
    },
    rows: {
      control: { type: 'number', min: 2, max: 20 },
      description: 'Number of rows in source edit mode',
    },
  },
  args: {
    onChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof JsonInput>;

const sampleJson = JSON.stringify(
  {
    name: 'Example Config',
    version: '1.0.0',
    settings: {
      enabled: true,
      maxRetries: 3,
      timeout: 5000,
    },
    tags: ['production', 'v1'],
  },
  null,
  2,
);

export const Default: Story = {
  args: {
    value: sampleJson,
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
};

export const WithLabel: Story = {
  args: {
    value: sampleJson,
    label: 'Configuration',
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
};

export const WithDescription: Story = {
  args: {
    value: sampleJson,
    label: 'API Response',
    description:
      'Edit the JSON configuration below. Changes are validated in real-time.',
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
};

export const Disabled: Story = {
  args: {
    value: sampleJson,
    label: 'Read-only Configuration',
    disabled: true,
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story:
          'Disabled state prevents editing but still shows the JSON viewer.',
      },
    },
  },
};

export const WithSchemaValidation: Story = {
  args: {
    value: JSON.stringify({ name: 'Test', count: 5 }, null, 2),
    label: 'Validated Input',
    description: 'Must have name (string) and count (number >= 0)',
    schema: z.object({
      name: z.string().min(1),
      count: z.number().min(0),
    }),
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story:
          'Schema validation using Zod. Invalid JSON will show validation errors.',
      },
    },
  },
};

export const Interactive: Story = {
  render: function InteractiveStory() {
    const [value, setValue] = useState(sampleJson);

    return (
      <div className="w-96 space-y-4">
        <JsonInput
          value={value}
          onChange={setValue}
          label="Edit JSON"
          description="Click the Source button to edit, or click values in the tree view"
        />
        <div className="bg-muted rounded p-2 text-xs">
          <strong>Current value length:</strong> {value.length} chars
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Interactive example with state management.',
      },
    },
  },
};

export const EmptyState: Story = {
  args: {
    value: '{}',
    label: 'Empty Object',
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
};

export const ArrayData: Story = {
  args: {
    value: JSON.stringify(
      [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
        { id: 3, name: 'Item 3' },
      ],
      null,
      2,
    ),
    label: 'Array Data',
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
};

export const CustomIndent: Story = {
  args: {
    value: sampleJson,
    label: 'Custom Indent (4 spaces)',
    indentWidth: 4,
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-[28rem]">
        <Story />
      </div>
    ),
  ],
};

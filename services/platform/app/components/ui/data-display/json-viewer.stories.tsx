import type { Meta, StoryObj } from '@storybook/react';

import { JsonViewer } from './json-viewer';

const meta: Meta<typeof JsonViewer> = {
  title: 'Data Display/JsonViewer',
  component: JsonViewer,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
An interactive JSON viewer component for displaying structured data.

## Usage
\`\`\`tsx
import { JsonViewer } from '@/app/components/ui/data-display/json-viewer';

<JsonViewer
  data={{ name: 'John', age: 30 }}
  collapsed={false}
  enableClipboard
/>
\`\`\`

## Features
- Syntax highlighting with theme support
- Collapsible nested objects
- Copy to clipboard functionality
- Handles both object and string JSON input
        `,
      },
    },
  },
  argTypes: {
    collapsed: {
      control: 'select',
      options: [false, true, 1, 2, 3],
      description:
        'Whether to collapse nested objects (false = expanded, true/number = collapsed at depth)',
    },
    enableClipboard: {
      control: 'boolean',
      description: 'Show copy to clipboard button',
    },
    indentWidth: {
      control: { type: 'number', min: 1, max: 8 },
      description: 'Number of spaces for indentation',
    },
  },
};

export default meta;
type Story = StoryObj<typeof JsonViewer>;

const sampleData = {
  id: 'user_123',
  name: 'John Doe',
  email: 'john@example.com',
  metadata: {
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-20T14:45:00Z',
    preferences: {
      theme: 'dark',
      notifications: true,
      language: 'en',
    },
  },
  tags: ['admin', 'verified', 'premium'],
  isActive: true,
  score: 95.5,
};

export const Default: Story = {
  args: {
    data: sampleData,
  },
  decorators: [
    (Story) => (
      <div className="w-96 overflow-hidden rounded-lg border">
        <Story />
      </div>
    ),
  ],
};

export const WithClipboard: Story = {
  args: {
    data: sampleData,
    enableClipboard: true,
  },
  decorators: [
    (Story) => (
      <div className="w-96 overflow-hidden rounded-lg border">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Enable the copy to clipboard button.',
      },
    },
  },
};

export const Collapsed: Story = {
  args: {
    data: sampleData,
    collapsed: true,
  },
  decorators: [
    (Story) => (
      <div className="w-96 overflow-hidden rounded-lg border">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'All nested objects collapsed by default.',
      },
    },
  },
};

export const CollapsedAtDepth: Story = {
  args: {
    data: sampleData,
    collapsed: 2,
  },
  decorators: [
    (Story) => (
      <div className="w-96 overflow-hidden rounded-lg border">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Objects collapsed at depth 2 and below.',
      },
    },
  },
};

export const SimpleObject: Story = {
  args: {
    data: { key: 'value', count: 42, active: true },
  },
  decorators: [
    (Story) => (
      <div className="w-64 overflow-hidden rounded-lg border">
        <Story />
      </div>
    ),
  ],
};

export const ArrayData: Story = {
  args: {
    data: [
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
      { id: 3, name: 'Item 3' },
    ],
  },
  decorators: [
    (Story) => (
      <div className="w-64 overflow-hidden rounded-lg border">
        <Story />
      </div>
    ),
  ],
};

export const StringInput: Story = {
  args: {
    data: '{"parsed": "from string", "number": 123}',
  },
  decorators: [
    (Story) => (
      <div className="w-64 overflow-hidden rounded-lg border">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Accepts JSON string input that gets parsed automatically.',
      },
    },
  },
};

export const CustomIndent: Story = {
  args: {
    data: sampleData,
    indentWidth: 4,
  },
  decorators: [
    (Story) => (
      <div className="w-[28rem] overflow-hidden rounded-lg border">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Custom indentation width (4 spaces).',
      },
    },
  },
};

export const LargeData: Story = {
  args: {
    data: {
      users: Array.from({ length: 10 }, (_, i) => ({
        id: `user_${i + 1}`,
        name: `User ${i + 1}`,
        email: `user${i + 1}@example.com`,
        role: i % 3 === 0 ? 'admin' : 'member',
      })),
      pagination: {
        page: 1,
        pageSize: 10,
        total: 100,
      },
    },
    collapsed: 2,
    enableClipboard: true,
  },
  decorators: [
    (Story) => (
      <div className="w-[28rem] overflow-hidden rounded-lg border">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Large dataset with collapsed depth and clipboard.',
      },
    },
  },
};

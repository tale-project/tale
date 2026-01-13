import type { Meta, StoryObj } from '@storybook/react';
import { TableDateCell, TableTimestampCell } from './table-date-cell';

const meta: Meta<typeof TableDateCell> = {
  title: 'Data Display/TableDateCell',
  component: TableDateCell,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A standardized table date cell component for consistent date formatting.

## Usage
\`\`\`tsx
import { TableDateCell, TableTimestampCell } from '@/components/ui/data-display/table-date-cell';

// In column definition
{
  id: 'createdAt',
  header: 'Created',
  cell: ({ row }) => (
    <TableDateCell date={row.original._creationTime} preset="relative" />
  ),
}

// For Convex timestamps
<TableTimestampCell timestamp={row.original._creationTime} />
\`\`\`

## Presets
- \`short\`: "Jan 15, 2024"
- \`medium\`: "January 15, 2024"
- \`long\`: "Monday, January 15, 2024 at 10:30 AM"
- \`relative\`: "2 days ago"
- \`time\`: "10:30 AM"
        `,
      },
    },
  },
  argTypes: {
    preset: {
      control: 'select',
      options: ['short', 'medium', 'long', 'relative', 'time'],
      description: 'Date format preset',
    },
    alignRight: {
      control: 'boolean',
      description: 'Right-align the text',
    },
    emptyText: {
      control: 'text',
      description: 'Text shown when date is null/undefined',
    },
  },
};

export default meta;
type Story = StoryObj<typeof TableDateCell>;

const sampleDate = new Date('2024-01-15T10:30:00Z');
const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago

export const Default: Story = {
  args: {
    date: sampleDate,
  },
};

export const AllPresets: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="w-20 text-sm text-muted-foreground">short:</span>
        <TableDateCell date={sampleDate} preset="short" />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-20 text-sm text-muted-foreground">medium:</span>
        <TableDateCell date={sampleDate} preset="medium" />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-20 text-sm text-muted-foreground">long:</span>
        <TableDateCell date={sampleDate} preset="long" />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-20 text-sm text-muted-foreground">relative:</span>
        <TableDateCell date={recentDate} preset="relative" />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-20 text-sm text-muted-foreground">time:</span>
        <TableDateCell date={sampleDate} preset="time" />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'All available date format presets.',
      },
    },
  },
};

export const Relative: Story = {
  args: {
    date: recentDate,
    preset: 'relative',
  },
  parameters: {
    docs: {
      description: {
        story: 'Relative format shows human-readable time difference.',
      },
    },
  },
};

export const AlignRight: Story = {
  render: () => (
    <div className="w-48 border rounded p-2">
      <TableDateCell date={sampleDate} alignRight />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Right-aligned for numeric columns.',
      },
    },
  },
};

export const NullDate: Story = {
  args: {
    date: null,
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows em-dash when date is null.',
      },
    },
  },
};

export const CustomEmptyText: Story = {
  args: {
    date: null,
    emptyText: 'Not set',
  },
  parameters: {
    docs: {
      description: {
        story: 'Custom text for null dates.',
      },
    },
  },
};

export const TimestampInput: Story = {
  args: {
    date: 1705312200000, // Timestamp in milliseconds
    preset: 'short',
  },
  parameters: {
    docs: {
      description: {
        story: 'Accepts timestamp numbers (milliseconds since epoch).',
      },
    },
  },
};

export const ISOStringInput: Story = {
  args: {
    date: '2024-01-15T10:30:00Z',
    preset: 'short',
  },
  parameters: {
    docs: {
      description: {
        story: 'Accepts ISO date strings.',
      },
    },
  },
};

export const InTableContext: Story = {
  render: () => (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b">
          <th className="text-left p-2 text-sm font-medium">Name</th>
          <th className="text-left p-2 text-sm font-medium">Created</th>
          <th className="text-right p-2 text-sm font-medium">Updated</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-b">
          <td className="p-2 text-sm">Document 1</td>
          <td className="p-2"><TableDateCell date={sampleDate} preset="short" /></td>
          <td className="p-2"><TableDateCell date={recentDate} preset="relative" alignRight /></td>
        </tr>
        <tr className="border-b">
          <td className="p-2 text-sm">Document 2</td>
          <td className="p-2"><TableDateCell date={new Date('2024-01-10')} preset="short" /></td>
          <td className="p-2"><TableDateCell date={null} alignRight /></td>
        </tr>
      </tbody>
    </table>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Example usage in a table context.',
      },
    },
  },
};

// TableTimestampCell stories
export const TimestampCell: Story = {
  render: () => (
    <div className="space-y-2">
      <div className="text-sm text-muted-foreground">TableTimestampCell (defaults to relative, right-aligned):</div>
      <TableTimestampCell timestamp={Date.now() - 3600000} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Convenience component for Convex _creationTime timestamps.',
      },
    },
  },
};

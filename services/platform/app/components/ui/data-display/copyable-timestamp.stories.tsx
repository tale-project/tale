import type { Meta, StoryObj } from '@storybook/react';

import { CopyableTimestamp } from './copyable-timestamp';

const NOW = Date.now();
const YESTERDAY = NOW - 86_400_000;
const LAST_WEEK = NOW - 7 * 86_400_000;

const meta: Meta<typeof CopyableTimestamp> = {
  title: 'Data Display/CopyableTimestamp',
  component: CopyableTimestamp,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Displays a formatted date with a copy-to-clipboard button that copies the raw
Unix millisecond timestamp. Intended for power users who need the exact value
for debugging or querying.

The copy button is hidden by default and appears on hover/focus.

## Usage
\`\`\`tsx
import { CopyableTimestamp } from '@/app/components/ui/data-display/copyable-timestamp';

<CopyableTimestamp date={document.lastModified} preset="short" alignRight />
\`\`\`

## Accessibility
- Copy button has an \`aria-label\`
- A screen-reader-only announcement is shown when copied
- Icons are decorative (\`aria-hidden\`)
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof CopyableTimestamp>;

export const Default: Story = {
  args: {
    date: NOW,
  },
};

export const ShortPreset: Story = {
  args: {
    date: NOW,
    preset: 'short',
  },
};

export const LongPreset: Story = {
  args: {
    date: NOW,
    preset: 'long',
  },
};

export const Yesterday: Story = {
  args: {
    date: YESTERDAY,
    preset: 'short',
  },
};

export const LastWeek: Story = {
  args: {
    date: LAST_WEEK,
    preset: 'medium',
  },
};

export const WithDateObject: Story = {
  args: {
    date: new Date(LAST_WEEK),
    preset: 'long',
  },
  parameters: {
    docs: {
      description: {
        story: 'Accepts a Date object in addition to Unix ms or ISO strings.',
      },
    },
  },
};

export const Empty: Story = {
  args: {
    date: null,
  },
  parameters: {
    docs: {
      description: {
        story: 'Renders an em-dash when the date is null or undefined.',
      },
    },
  },
};

export const AlignRight: Story = {
  render: () => (
    <div className="w-48 rounded border p-2">
      <CopyableTimestamp date={NOW} preset="short" alignRight />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Right-aligned for use in table columns.',
      },
    },
  },
};

export const InTableRow: Story = {
  render: () => (
    <table className="border-collapse text-sm">
      <thead>
        <tr>
          <th className="border p-2 text-left">Name</th>
          <th className="border p-2 text-right">Modified</th>
        </tr>
      </thead>
      <tbody>
        {[
          { name: 'Design brief.pdf', date: NOW },
          { name: 'Q1 report.docx', date: YESTERDAY },
          { name: 'Onboarding guide.pdf', date: LAST_WEEK },
        ].map(({ name, date }) => (
          <tr key={name}>
            <td className="border p-2">{name}</td>
            <td className="border p-2">
              <CopyableTimestamp date={date} preset="short" alignRight />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Hover a row to reveal the copy button.',
      },
    },
  },
};

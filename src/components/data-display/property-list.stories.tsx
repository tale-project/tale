import type { Meta, StoryObj } from '@storybook/react';
import { Settings2 } from 'lucide-react';

import { Badge } from '../feedback/badge';
import { IconButton } from '../primitives/icon-button';
import { PropertyDivider, PropertyList, PropertyRow } from './property-list';

const meta: Meta<typeof PropertyList> = {
  title: 'Data Display/PropertyList',
  component: PropertyList,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
The column of a record's properties: a fixed-width muted label beside each value, groups split by a hairline. The task dialog's and the task page's details panels are built from it.

## Usage
\`\`\`tsx
import {
  PropertyDivider,
  PropertyList,
  PropertyRow,
} from '@tale/ui/property-list';

<PropertyList as="aside" className="w-[17rem]">
  <PropertyRow label="Status">{statusPicker}</PropertyRow>
  <PropertyRow label="Due date">{datePicker}</PropertyRow>
  <PropertyDivider />
  <PropertyRow label="Labels" stacked trailing={manageButton}>{labelEditor}</PropertyRow>
</PropertyList>
\`\`\`

## Accessibility
- The label is visible text beside its control; name each control so it reads alone ("Priority: Medium"), as a picker trigger does
- A label longer than its 80px column wraps (with hyphenation where the browser has a dictionary) instead of covering the control
- \`PropertyDivider\` is decorative and hidden from assistive technology
- \`as\` renders a landmark (\`aside\`) for a details panel
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof PropertyList>;

function Value({ children }: { children: string }) {
  return (
    <span className="text-foreground block truncate text-sm leading-7">
      {children}
    </span>
  );
}

export const Default: Story = {
  render: () => (
    <PropertyList as="aside" className="w-[17rem]">
      <PropertyRow label="Status">
        <Value>In progress</Value>
      </PropertyRow>
      <PropertyRow label="Priority">
        <Value>Medium</Value>
      </PropertyRow>
      <PropertyRow label="Assignee">
        <Value>Ada Lovelace</Value>
      </PropertyRow>
      <PropertyRow label="Start date">
        <Value>Oct 8, 2026</Value>
      </PropertyRow>
      <PropertyRow label="Due date">
        <Value>Oct 12, 2026</Value>
      </PropertyRow>
      <PropertyDivider />
      <PropertyRow
        label="Labels"
        stacked
        trailing={
          <IconButton
            icon={Settings2}
            size="sm"
            className="text-muted-foreground -my-1 size-6"
            aria-label="Manage labels"
          />
        }
      >
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline">Launch</Badge>
          <Badge variant="outline">Docs</Badge>
        </div>
      </PropertyRow>
    </PropertyList>
  ),
};

export const LongLabels: Story = {
  render: () => (
    <div lang="de">
      <PropertyList className="w-[17rem]">
        <PropertyRow label="Status">
          <Value>In Arbeit</Value>
        </PropertyRow>
        <PropertyRow label="Fälligkeitsdatum">
          <Value>12. Okt. 2026</Value>
        </PropertyRow>
        <PropertyRow label="Agentenausführung">
          <Value>Läuft seit 2 Min.</Value>
        </PropertyRow>
      </PropertyList>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'A German compound longer than the label column wraps inside it instead of covering its value.',
      },
    },
  },
};

export const StackedFromMd: Story = {
  render: () => (
    <PropertyList className="w-[17rem]">
      <PropertyRow label="Repeat" stacked="md">
        <Value>Every week on Monday</Value>
      </PropertyRow>
    </PropertyList>
  ),
  parameters: {
    docs: {
      description: {
        story:
          '`stacked="md"` puts the label above the value from the `md` breakpoint up, and beside it on a phone, where a drawer gives the panel its full width.',
      },
    },
  },
};

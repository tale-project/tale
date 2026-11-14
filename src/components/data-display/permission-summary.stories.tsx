import type { Meta, StoryObj } from '@storybook/react';

import { PermissionSummary } from './permission-summary';

const meta: Meta<typeof PermissionSummary> = {
  title: 'Data Display/PermissionSummary',
  component: PermissionSummary,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
What a choice lets someone do and what it does not: one line for each permission, a check for what is allowed and a dash for what is not. The consent page for a coding agent shows it beside the access levels, and updates it as the person chooses.

## Usage
\`\`\`tsx
import { PermissionSummary } from '@tale/ui/permission-summary';

<PermissionSummary
  title="What Claude Code will be able to do"
  items={[
    { label: 'Read automations, runs and versions', allowed: true },
    {
      label: 'Edit automations',
      allowed: false,
      detail: 'Your role in Acme does not allow this.',
    },
  ]}
  footer="Limited by your role, Developer."
/>
\`\`\`

## Accessibility
- The state is a shape and a word, never colour alone: each line carries a check or a dash and a visually hidden "Allowed:" or "Not allowed:" ahead of its label
- The title names the list; without one the list has no accessible name
- A list that changes as the reader chooses needs \`aria-live="polite"\` on the component, set by the host
- Long labels, details and the footer wrap inside the column at any width
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[22rem]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof PermissionSummary>;

export const Default: Story = {
  args: {
    title: 'What Claude Code will be able to do',
    items: [
      { label: 'Read automations, runs and versions', allowed: true },
      { label: 'Test automations with mock data', allowed: true },
      {
        label: 'Edit and deploy automations',
        allowed: false,
        detail: 'Your role in Acme does not allow this.',
      },
      {
        label: 'Change settings',
        allowed: false,
        detail: 'The agent did not ask for this.',
      },
    ],
    footer: 'Limited by your role in Acme, Developer.',
  },
};

export const AllAllowed: Story = {
  args: {
    title: 'What this connection can do',
    items: [
      { label: 'Read automations, runs and versions', allowed: true },
      { label: 'Edit and deploy automations', allowed: true },
      { label: 'Read and change settings', allowed: true },
    ],
  },
};

export const NothingAllowed: Story = {
  args: {
    items: [
      { label: 'Read automations', allowed: false },
      { label: 'Edit automations', allowed: false },
    ],
  },
};

export const LongText: Story = {
  decorators: [
    (Story) => (
      <div className="w-[17.5rem]">
        <Story />
      </div>
    ),
  ],
  args: {
    title: 'Was dieser Agent in der Organisation darf',
    items: [
      {
        label: 'Automatisierungen, Läufe und Versionsstände vollständig lesen',
        allowed: true,
        detail: 'Verwaltungsvorschriftenänderungsbefugnisse inbegriffen.',
      },
      {
        label: 'Einstellungen ändern',
        allowed: false,
        detail: 'Deine Rolle in dieser Organisation erlaubt das nicht.',
      },
    ],
    footer: 'Begrenzt durch deine Rolle: Entwickler.',
  },
};

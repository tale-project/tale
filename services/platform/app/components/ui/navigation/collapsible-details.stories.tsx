import type { Meta, StoryObj } from '@storybook/react';

import { Text } from '../typography/text';
import { CollapsibleDetails } from './collapsible-details';

const meta: Meta<typeof CollapsibleDetails> = {
  title: 'Navigation/CollapsibleDetails',
  component: CollapsibleDetails,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A native \`<details>\` element styled with a chevron indicator that rotates when open.

## Usage
\`\`\`tsx
import { CollapsibleDetails } from '@/app/components/ui/navigation/collapsible-details';

<CollapsibleDetails summary="Advanced settings">
  <p>Hidden content revealed on expand.</p>
</CollapsibleDetails>
\`\`\`
        `,
      },
    },
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

type Story = StoryObj<typeof CollapsibleDetails>;

export const Default: Story = {
  render: () => (
    <CollapsibleDetails summary="Advanced settings">
      <div className="mt-2 flex flex-col gap-2 pl-5">
        <Text variant="muted">Timeout: 30s</Text>
        <Text variant="muted">Retry attempts: 3</Text>
        <Text variant="muted">Log level: info</Text>
      </div>
    </CollapsibleDetails>
  ),
};

export const Compact: Story = {
  render: () => (
    <CollapsibleDetails summary="Details" variant="compact">
      <div className="mt-1 pl-5">
        <Text variant="caption" as="span">
          Additional metadata displayed in compact style.
        </Text>
      </div>
    </CollapsibleDetails>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Compact variant uses smaller, muted text for the summary.',
      },
    },
  },
};

export const DefaultOpen: Story = {
  render: () => (
    <CollapsibleDetails summary="Expanded by default" open>
      <div className="mt-2 flex flex-col gap-2 pl-5">
        <Text variant="muted">This section is open on first render.</Text>
        <Text variant="muted">Click the summary to collapse it.</Text>
      </div>
    </CollapsibleDetails>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The open prop renders the details element in its expanded state.',
      },
    },
  },
};

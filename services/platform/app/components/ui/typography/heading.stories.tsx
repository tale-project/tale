import type { Meta, StoryObj } from '@storybook/react';

import { Heading } from './heading';

const meta: Meta<typeof Heading> = {
  title: 'Typography/Heading',
  component: Heading,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Standardized heading component with consistent sizing and weight across the application.

## Usage

\`\`\`tsx
import { Heading } from '@/app/components/ui/typography/heading';

<Heading level={1} size="lg">Page title</Heading>
<Heading level={2} size="base">Section title</Heading>
<Heading level={3} size="sm">Subsection title</Heading>
\`\`\`
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Heading>;

export const Default: Story = {
  args: { children: 'Section heading' },
};

export const Levels: Story = {
  render: () => (
    <div className="space-y-4">
      <Heading level={1} size="2xl">
        Heading 1 (2xl)
      </Heading>
      <Heading level={2} size="xl">
        Heading 2 (xl)
      </Heading>
      <Heading level={3} size="lg">
        Heading 3 (lg)
      </Heading>
      <Heading level={4} size="base">
        Heading 4 (base)
      </Heading>
      <Heading level={5} size="sm">
        Heading 5 (sm)
      </Heading>
      <Heading level={6} size="xs">
        Heading 6 (xs)
      </Heading>
    </div>
  ),
};

export const PageTitle: Story = {
  render: () => (
    <Heading level={1} size="base" truncate>
      Custom agents / My first agent
    </Heading>
  ),
};

export const PanelTitle: Story = {
  render: () => (
    <Heading level={2} size="sm">
      Test chat
    </Heading>
  ),
};

export const Weights: Story = {
  render: () => (
    <div className="space-y-2">
      <Heading weight="medium">Medium weight</Heading>
      <Heading weight="semibold">Semibold weight</Heading>
      <Heading weight="bold">Bold weight</Heading>
    </div>
  ),
};

export const Truncated: Story = {
  render: () => (
    <div className="w-48">
      <Heading truncate>
        This is a very long heading that will be truncated
      </Heading>
    </div>
  ),
};

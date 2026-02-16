import type { Meta, StoryObj } from '@storybook/react';

import { Button } from '../primitives/button';
import { Card } from './card';

const meta: Meta<typeof Card> = {
  title: 'Layout/Card',
  component: Card,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A single-piece card component for grouping related content.

## Usage
\`\`\`tsx
import { Card } from '@/app/components/ui/layout/card';

<Card title="Card Title" description="Card description">
  Content goes here
</Card>
\`\`\`
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: () => (
    <Card
      title="Card Title"
      description="This is a description of the card content."
    >
      <p>Card content goes here. This can be any content you want.</p>
    </Card>
  ),
};

export const WithFooter: Story = {
  render: () => (
    <Card
      title="Create Project"
      description="Deploy your new project in one-click."
      footer={
        <div className="flex gap-2">
          <Button variant="secondary">Cancel</Button>
          <Button>Deploy</Button>
        </div>
      }
    >
      <p className="text-muted-foreground text-sm">
        Your project will be deployed to our cloud infrastructure.
      </p>
    </Card>
  ),
};

export const SimpleCard: Story = {
  render: () => (
    <Card>
      <p>A simple card with only content.</p>
    </Card>
  ),
};

export const TitleOnly: Story = {
  render: () => (
    <Card title="Notifications">
      <p className="text-muted-foreground text-sm">
        You have 3 unread messages.
      </p>
    </Card>
  ),
};

export const Interactive: Story = {
  render: () => (
    <Card
      title="Clickable Card"
      description="Hover to see the effect"
      className="cursor-pointer transition-shadow hover:shadow-md"
    >
      <p className="text-sm">Click this card to navigate somewhere.</p>
    </Card>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Cards can be styled to appear interactive.',
      },
    },
  },
};

export const CardGrid: Story = {
  render: () => (
    <div className="grid w-[500px] grid-cols-2 gap-4">
      <Card title="Revenue" headerClassName="pb-2">
        <p className="text-2xl font-bold">$45,231.89</p>
        <p className="text-muted-foreground text-xs">+20.1% from last month</p>
      </Card>
      <Card title="Users" headerClassName="pb-2">
        <p className="text-2xl font-bold">+2,350</p>
        <p className="text-muted-foreground text-xs">+180.1% from last month</p>
      </Card>
    </div>
  ),
  decorators: [],
  parameters: {
    docs: {
      description: {
        story: 'Cards in a grid layout for dashboards.',
      },
    },
  },
};

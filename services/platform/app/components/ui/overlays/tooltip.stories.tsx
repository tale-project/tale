import type { Meta, StoryObj } from '@storybook/react';

import { Info, HelpCircle } from 'lucide-react';

import { Button } from '../primitives/button';
import { IconButton } from '../primitives/icon-button';
import { Tooltip } from './tooltip';

const meta: Meta<typeof Tooltip> = {
  title: 'Overlays/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A tooltip component for displaying additional information on hover.

## Usage
\`\`\`tsx
import { Tooltip } from '@/app/components/ui/overlays/tooltip';

<Tooltip content="Tooltip content">
  <button>Hover me</button>
</Tooltip>
\`\`\`

## Accessibility
- Built on Radix UI Tooltip
- Shows on hover and focus
- Dismisses on Escape
- Proper ARIA attributes
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Default: Story = {
  render: () => (
    <Tooltip content="This is a tooltip">
      <Button variant="secondary">Hover me</Button>
    </Tooltip>
  ),
};

export const OnIconButton: Story = {
  render: () => (
    <Tooltip content="More information about this feature">
      <IconButton icon={Info} aria-label="More information" />
    </Tooltip>
  ),
};

export const Positions: Story = {
  render: () => (
    <div className="flex gap-4">
      <Tooltip content="Tooltip on top" side="top">
        <Button variant="secondary">Top</Button>
      </Tooltip>
      <Tooltip content="Tooltip on right" side="right">
        <Button variant="secondary">Right</Button>
      </Tooltip>
      <Tooltip content="Tooltip on bottom" side="bottom">
        <Button variant="secondary">Bottom</Button>
      </Tooltip>
      <Tooltip content="Tooltip on left" side="left">
        <Button variant="secondary">Left</Button>
      </Tooltip>
    </div>
  ),
};

export const WithIcon: Story = {
  render: () => (
    <div className="flex items-center gap-1">
      <span className="text-sm">What is this?</span>
      <Tooltip content="This explains what the feature does.">
        <HelpCircle className="text-muted-foreground size-4" />
      </Tooltip>
    </div>
  ),
};

export const LongContent: Story = {
  render: () => (
    <Tooltip
      content="This is a longer tooltip with more detailed information. It wraps to multiple lines when the content is too long."
      contentClassName="max-w-xs"
    >
      <Button variant="secondary">Hover for details</Button>
    </Tooltip>
  ),
};

export const DisabledTrigger: Story = {
  render: () => (
    <Tooltip content="This button is disabled because you need to fill out the form first.">
      <span tabIndex={0}>
        <Button variant="secondary" disabled>
          Disabled Button
        </Button>
      </span>
    </Tooltip>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Wrap disabled elements in a span for tooltip to work on disabled buttons.',
      },
    },
  },
};

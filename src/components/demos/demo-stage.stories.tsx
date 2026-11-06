import type { Meta, StoryObj } from '@storybook/react';

import { DemoToolbar } from './demo-chrome';
import { DemoShell } from './demo-shell';
import { DemoStage } from './demo-stage';

const meta = {
  title: 'Demos/DemoStage',
  component: DemoStage,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof DemoStage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A list-page window — the frame a host's demo scene renders inside. */
function PlaceholderWindow() {
  return (
    <DemoShell
      label="Placeholder product window on the stage."
      title="Agents"
      activeNav="agents"
      className="aspect-[16/10]"
    >
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <DemoToolbar searchPlaceholder="Search agents" addLabel="Add agent" />
        <div className="text-fg-muted text-sm">Scene content goes here.</div>
      </div>
    </DemoShell>
  );
}

export const Hero: Story = {
  args: {
    variant: 'hero',
    children: <PlaceholderWindow />,
  },
};

export const Section: Story = {
  args: {
    variant: 'section',
    children: <PlaceholderWindow />,
  },
};

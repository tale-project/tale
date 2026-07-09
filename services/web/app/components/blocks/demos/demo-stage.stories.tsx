import type { Meta, StoryObj } from '@storybook/react';
import { AppShell } from '@tale/ui/app-shell';

import { i18n } from '@/lib/i18n/i18n';

import { DemoStage } from './demo-stage';
import { HeroOrchestration } from './hero-orchestration';

const meta = {
  title: 'Blocks/Demos/DemoStage',
  component: DemoStage,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <AppShell i18n={i18n}>
        <Story />
      </AppShell>
    ),
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof DemoStage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Hero: Story = {
  args: {
    variant: 'hero',
    children: <HeroOrchestration />,
  },
};

export const Section: Story = {
  args: {
    variant: 'section',
    children: (
      <div className="text-fg-muted p-8 text-sm">Section stage placeholder</div>
    ),
  },
};

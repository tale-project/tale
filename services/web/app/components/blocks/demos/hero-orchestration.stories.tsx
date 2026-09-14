import type { Meta, StoryObj } from '@storybook/react';
import { DemoStage } from '@tale/marketing-ui/demo-stage';
import { AppShell } from '@tale/ui/app-shell';

import { i18n } from '@/lib/i18n/i18n';

import { HeroOrchestration } from './hero-orchestration';

const meta = {
  title: 'Blocks/Demos/HeroOrchestration',
  component: HeroOrchestration,
  parameters: {
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <AppShell i18n={i18n}>
        <div className="mx-auto w-full max-w-4xl">
          <Story />
        </div>
      </AppShell>
    ),
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof HeroOrchestration>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PlaysOnMount: Story = {};

/** The homepage composition: the hero window on the full-bleed hero stage. */
export const OnHeroStage: Story = {
  name: 'On the hero DemoStage',
  parameters: { layout: 'fullscreen' },
  render: () => (
    <DemoStage variant="hero">
      <HeroOrchestration />
    </DemoStage>
  ),
};

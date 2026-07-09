import type { Meta, StoryObj } from '@storybook/react';
import { AppShell } from '@tale/ui/app-shell';

import { i18n } from '@/lib/i18n/i18n';

import { AutomationRun } from './automation-run';
import { ChatArena } from './chat-arena';
import { ConnectAgents } from './connect-agents';
import {
  AgentsHeroDemo,
  AgentsTourProjectsDemo,
  AutomationsTourAgentsDemo,
  AutomationsTourProjectsDemo,
  ChatTourKnowledgeDemo,
  ChatTourProjectsDemo,
  ConversationsTourArenaDemo,
  ConversationsTourKnowledgeDemo,
  ConversationsTourProjectsDemo,
  GovernanceTourAgentsDemo,
  HubHeroDemo,
  HubTourAgentsDemo,
  HubTourProjectsDemo,
  KnowledgeTourProjectsDemo,
} from './content';
import {
  useArenaScenario,
  useAutomationScenario,
  useChatScenario,
  useGovernScenario,
  useKnowledgeScenario,
} from './demo-scenarios';
import { DemoStage } from './demo-stage';
import { GovernGate } from './govern-gate';
import { HeroOrchestration } from './hero-orchestration';
import { KnowledgePool } from './knowledge-pool';
import { ProjectsBoard } from './projects-board';

const meta = {
  title: 'Blocks/Demos/TourDemos',
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
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connect: Story = { render: () => <ConnectAgents /> };
export const Knowledge: Story = { render: () => <KnowledgePool /> };
export const Automation: Story = { render: () => <AutomationRun /> };
export const Govern: Story = { render: () => <GovernGate /> };
export const Arena: Story = { render: () => <ChatArena /> };
export const Projects: Story = { render: () => <ProjectsBoard /> };

export const ConnectOnStage: Story = {
  name: 'Connect (on DemoStage)',
  render: () => (
    <DemoStage variant="section">
      <ConnectAgents />
    </DemoStage>
  ),
};

/**
 * The same windows telling per-page stories: scenario props swap the content
 * (rows, prompts, approvals) while chrome and motion stay identical.
 */
function PageScenarioShowcase() {
  const invoicePipeline = useAutomationScenario('platformAutomations');
  const invoiceApproval = useGovernScenario('platformAutomations');
  const orgLibrary = useKnowledgeScenario('platformKnowledge');
  const publishEntries = useGovernScenario('platformGovernance');
  const announcementDuel = useArenaScenario('platformChat');
  const resumedThread = useChatScenario('platformConversations');
  return (
    <div className="flex flex-col gap-8">
      <DemoStage>
        <AutomationRun scenario={invoicePipeline} />
      </DemoStage>
      <DemoStage>
        <GovernGate scenario={invoiceApproval} />
      </DemoStage>
      <DemoStage>
        <KnowledgePool scenario={orgLibrary} />
      </DemoStage>
      <DemoStage>
        <GovernGate scenario={publishEntries} />
      </DemoStage>
      <DemoStage>
        <ChatArena scenario={announcementDuel} />
      </DemoStage>
      <DemoStage>
        <HeroOrchestration scenario={resumedThread} elevation="default" />
      </DemoStage>
      <DemoStage>
        <HubHeroDemo />
      </DemoStage>
      <DemoStage>
        <HubTourAgentsDemo />
      </DemoStage>
      <DemoStage>
        <HubTourProjectsDemo />
      </DemoStage>
      <DemoStage>
        <AgentsHeroDemo />
      </DemoStage>
      <DemoStage>
        <AgentsTourProjectsDemo />
      </DemoStage>
      <DemoStage>
        <ChatTourProjectsDemo />
      </DemoStage>
      <DemoStage>
        <ChatTourKnowledgeDemo />
      </DemoStage>
      <DemoStage>
        <AutomationsTourAgentsDemo />
      </DemoStage>
      <DemoStage>
        <AutomationsTourProjectsDemo />
      </DemoStage>
      <DemoStage>
        <KnowledgeTourProjectsDemo />
      </DemoStage>
      <DemoStage>
        <GovernanceTourAgentsDemo />
      </DemoStage>
      <DemoStage>
        <ConversationsTourArenaDemo />
      </DemoStage>
      <DemoStage>
        <ConversationsTourProjectsDemo />
      </DemoStage>
      <DemoStage>
        <ConversationsTourKnowledgeDemo />
      </DemoStage>
    </div>
  );
}

export const PageScenarios: Story = {
  name: 'Per-page scenarios',
  parameters: {
    chromatic: { pauseAnimationAtEnd: true },
  },
  render: () => <PageScenarioShowcase />,
};

export const ReducedMotionEndState: Story = {
  name: 'All demos (stacked)',
  parameters: {
    chromatic: { pauseAnimationAtEnd: true },
  },
  render: () => (
    <div className="flex flex-col gap-8">
      <DemoStage>
        <ConnectAgents />
      </DemoStage>
      <DemoStage>
        <KnowledgePool />
      </DemoStage>
      <DemoStage>
        <AutomationRun />
      </DemoStage>
      <DemoStage>
        <GovernGate />
      </DemoStage>
      <DemoStage>
        <ChatArena />
      </DemoStage>
      <DemoStage>
        <ProjectsBoard />
      </DemoStage>
    </div>
  ),
};

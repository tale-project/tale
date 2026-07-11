import type { Meta, StoryObj } from '@storybook/react';
import { AppShell } from '@tale/ui/app-shell';

import { i18n } from '@/lib/i18n/i18n';

import { MarketingButton } from './button';
import { MarketingCard } from './card';
import { CtaPair } from './cta-group';
import { MarketingLink } from './link';
import { PageSection } from './page-section';
import { MarketingPanel } from './panel';
import { SectionHeading } from './section-heading';
import { MarketingStack } from './stack';

const meta = {
  title: 'Marketing/Kit',
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <AppShell i18n={i18n}>
        <Story />
      </AppShell>
    ),
  ],
  tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SectionAndCtas: Story = {
  render: () => (
    <PageSection surface="site" pad="lg" border="b">
      <MarketingStack max="md" gap="md">
        <SectionHeading
          size="section"
          title="Marketing kit"
          description="PageSection, SectionHeading, CtaPair, and MarketingButton — the primitives every new page should compose."
        />
        <CtaPair
          primary={{ label: 'Request a demo', to: '/request-demo' }}
          secondary={{ label: 'Contact', to: '/contact' }}
        />
        <div className="flex flex-wrap gap-3">
          <MarketingButton>Primary</MarketingButton>
          <MarketingButton tone="secondary">Secondary</MarketingButton>
          <MarketingLink to="/pricing" tone="inline">
            Inline link
          </MarketingLink>
        </div>
      </MarketingStack>
    </PageSection>
  ),
};

export const Cards: Story = {
  render: () => (
    <PageSection pad="lg" border="none">
      <MarketingPanel className="mx-auto max-w-4xl">
        <ul role="list" className="bg-border-base grid gap-px sm:grid-cols-2">
          <li className="bg-surface-site-raised">
            <MarketingCard
              to="/platform/agents"
              title="Agents"
              description="Orchestrate Claude Code, Codex, Hermes, and OpenClaw."
            />
          </li>
          <li className="bg-surface-site-raised">
            <MarketingCard
              to="/platform/automations"
              title="Automations"
              description="Typed workflows with triggers and approvals."
            />
          </li>
        </ul>
      </MarketingPanel>
    </PageSection>
  ),
};

export const SoftBand: Story = {
  render: () => (
    <PageSection surface="soft" pad="lg" border="none">
      <MarketingStack max="md" gap="md" align="stretch">
        <SectionHeading
          size="section"
          title="Soft band"
          description="PageSection surface soft — cream to wash for closing moments and step strips."
          align="start"
        />
        <MarketingPanel>
          <ul role="list" className="divide-border-base divide-y">
            <li>
              <MarketingCard
                to="/platform/knowledge"
                title="Knowledge"
                description="Ground agents in docs your team already trusts."
              />
            </li>
          </ul>
        </MarketingPanel>
      </MarketingStack>
    </PageSection>
  ),
};

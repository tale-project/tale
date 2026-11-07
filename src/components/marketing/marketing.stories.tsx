import type { Meta, StoryObj } from '@storybook/react';
import { expect, within } from 'storybook/test';

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

export const FeaturedDestinations: Story = {
  render: () => (
    <PageSection>
      <SectionHeading
        layout="editorial"
        align="start"
        title="A place to start. Room to go further."
        description="Give the first useful action more space, with quieter destinations beside it."
      />
      <div className="mt-10 grid gap-6 md:grid-cols-[1.2fr_1fr] md:gap-12">
        <MarketingCard
          surface="featured"
          title="Build your first project"
          description="Take a task from a clear brief to a reviewed result."
          to="/start"
          reveal={false}
        >
          <span className="text-fg-subtle mt-10 block text-sm">
            A guided introduction
          </span>
        </MarketingCard>
        <div className="divide-border-base divide-y">
          <MarketingCard
            surface="quiet"
            title="Explore the components"
            description="Find the controls and patterns for your next interface."
            to="/components"
            reveal={false}
          />
          <MarketingCard
            surface="quiet"
            title="Connect your tools"
            description="Build on the API and integration guides."
            to="/integrations"
            reveal={false}
          />
        </div>
      </div>
    </PageSection>
  ),
};

export const ScopedContrast: Story = {
  render: () => (
    <>
      <PageSection pad="compact">
        <p data-testid="before" className="text-fg-base">
          Ordinary page content
        </p>
      </PageSection>
      <PageSection surface="contrast">
        <SectionHeading
          title="Your next useful step"
          description="A deliberate change of pace for one important decision."
          align="start"
        />
        <p data-testid="inside" className="text-fg-base mt-5">
          The band owns its colors.
        </p>
        <div className="mt-8">
          <CtaPair
            align="start"
            primary={{ label: 'Get started', to: '/start' }}
            secondary={{ label: 'Explore the guides', to: '/guides' }}
          />
        </div>
      </PageSection>
      <PageSection pad="compact">
        <p data-testid="after" className="text-fg-base">
          Back to the page palette
        </p>
      </PageSection>
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const before = getComputedStyle(canvas.getByTestId('before')).color;
    const inside = getComputedStyle(canvas.getByTestId('inside')).color;
    const after = getComputedStyle(canvas.getByTestId('after')).color;
    await expect(inside).not.toBe(before);
    await expect(after).toBe(before);
    const action = canvas.getByRole('link', { name: 'Get started' });
    await expect(action).toHaveAttribute('href', '/start');
    await expect(getComputedStyle(action).color).not.toBe(inside);
  },
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

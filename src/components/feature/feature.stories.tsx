import type { Meta, StoryObj } from '@storybook/react';
import { Bot, ShieldCheck, Workflow } from 'lucide-react';

import { CtaPair } from '../marketing/cta-group';
import { DocsLinks } from './docs-links';
import { FeatureCapability } from './feature-capability';
import { FeatureCta } from './feature-cta';
import { FeatureFaq } from './feature-faq';
import { FeatureHero } from './feature-hero';
import { FeatureSteps } from './feature-steps';
import { RelatedPages } from './related-pages';

const meta = {
  title: 'Feature/Blocks',
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Hero: Story = {
  render: () => (
    <FeatureHero
      eyebrow="Platform"
      title="What are agents in Tale?"
      description="Dock Claude Code, Codex, Hermes, and OpenClaw beside in-product agents — one orchestrator, shared knowledge, approvals on the way out."
      actions={
        <CtaPair
          primary={{ label: 'Get started', href: 'https://docs.tale.dev' }}
          secondary={{ label: 'Request a demo', to: '/request-demo' }}
        />
      }
    />
  ),
};

export const Capability: Story = {
  render: () => (
    <FeatureCapability
      heading="Capabilities"
      description="What this module ships."
      items={[
        {
          title: 'External coding agents',
          body: 'Connect the agents your team already runs.',
        },
        {
          title: 'Shared knowledge',
          body: 'Cite the same library across every agent.',
        },
      ]}
    />
  ),
};

export const Steps: Story = {
  render: () => (
    <FeatureSteps
      heading="How it works"
      description="Three steps from dock to governed run."
      steps={[
        { title: 'Connect', body: 'Dock agents and providers.' },
        { title: 'Ground', body: 'Attach knowledge sources.' },
        { title: 'Govern', body: 'Require approvals before side effects.' },
      ]}
    />
  ),
};

export const Faq: Story = {
  render: () => (
    <FeatureFaq
      heading="FAQ"
      items={[
        {
          question: 'Is Community free?',
          answer: 'Yes. Self-host under the MIT license.',
        },
        {
          question: 'Does Enterprise add features?',
          answer: 'Enterprise adds support and services on the same codebase.',
        },
      ]}
    />
  ),
};

export const RelatedAndCta: Story = {
  name: 'Related + docs + CTA',
  render: () => (
    <>
      <RelatedPages
        heading="Related modules"
        items={[
          {
            id: 'agents',
            to: '/platform/agents',
            title: 'Agents',
            description: 'Dock coding agents beside in-product ones.',
            icon: Bot,
          },
          {
            id: 'automations',
            to: '/platform/automations',
            title: 'Automations',
            description: 'Typed workflows with triggers and approvals.',
            icon: Workflow,
          },
          {
            id: 'governance',
            to: '/platform/governance',
            title: 'Governance',
            description: 'Approvals on the way out.',
            icon: ShieldCheck,
          },
        ]}
      />
      <DocsLinks
        heading="Read the docs"
        links={[
          { label: 'Agents overview', href: 'https://docs.tale.dev/agents' },
          { label: 'Quickstart', href: 'https://docs.tale.dev/quickstart' },
        ]}
      />
      <FeatureCta
        title="See Tale on your stack"
        description="Book a guided demo or talk to the team about self-hosted deployment, pricing, and hardware."
        primary={{ label: 'Request a demo', to: '/request-demo' }}
        secondary={{ label: 'Contact us', to: '/contact' }}
      />
    </>
  ),
};

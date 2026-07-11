import type { Meta, StoryObj } from '@storybook/react';
import { AppShell } from '@tale/ui/app-shell';

import { i18n } from '@/lib/i18n/i18n';

import { DocsLinks } from './docs-links';
import { FeatureCapability } from './feature-capability';
import { FeatureCta } from './feature-cta';
import { FeatureFaq } from './feature-faq';
import { FeatureHero } from './feature-hero';
import { FeatureSteps } from './feature-steps';
import { RelatedPages } from './related-pages';

const meta = {
  title: 'Blocks/Feature',
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
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Hero: Story = {
  render: () => (
    <FeatureHero
      eyebrow="Platform"
      title="What are agents in Tale?"
      description="Dock Claude Code, Codex, Hermes, and OpenClaw beside in-product agents — one orchestrator, shared knowledge, approvals on the way out."
      showCtas
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
  name: 'Related + CTA',
  render: () => (
    <>
      <RelatedPages
        heading="Related"
        currentId="agents"
        relatedIds={['knowledge', 'governance', 'automations']}
      />
      <DocsLinks
        heading="Docs"
        links={[
          { label: 'Agents overview', href: 'https://tale.dev/docs' },
          { label: 'Quickstart', href: 'https://tale.dev/docs' },
        ]}
      />
      <FeatureCta />
    </>
  ),
};

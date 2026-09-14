import type { Meta, StoryObj } from '@storybook/react';
import { AppShell } from '@tale/ui/app-shell';

import { i18n } from '@/lib/i18n/i18n';

import { DocsLinks } from './docs-links';
import { FeatureCta } from './feature-cta';
import { FeatureHero } from './feature-hero';
import { RelatedPages } from './related-pages';

/**
 * The site-bound wrappers over the `@tale/marketing-ui` feature frames —
 * the frames themselves (capabilities, steps, FAQ, …) are catalogued in the
 * package's own Storybook; these stories show what this site feeds them.
 */
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

export const RelatedAndCta: Story = {
  name: 'Related + docs + CTA',
  render: () => (
    <>
      <RelatedPages
        currentId="agents"
        relatedIds={['knowledge', 'governance', 'automations']}
      />
      <DocsLinks
        links={[
          { label: 'Agents overview', href: 'https://tale.dev/docs' },
          { label: 'Quickstart', href: 'https://tale.dev/docs' },
        ]}
      />
      <FeatureCta />
    </>
  ),
};

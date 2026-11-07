import type { Meta, StoryObj } from '@storybook/react';
import { Markdown } from '@tale/ui/markdown';
import { markdownComponents } from '@tale/ui/markdown/components/registry';
import { extractToc } from '@tale/ui/markdown/extract-toc';

import { ACTIVE_HREF, SECTIONS } from './__fixtures__/docs-nav';
import { DocsArticle } from './docs-article';
import { DocsHeader } from './docs-header';
import { DocsLayout, type DocsLayoutProps } from './docs-layout';
import { DocsNotFound } from './docs-not-found';
import { PageActions } from './page-actions';

const BODY = `## Before you begin

Install Docker and make sure it is running before you start.

### Install the CLI

The CLI creates the project and starts its services.

## Start Tale

Open the address the CLI prints and follow the setup wizard.
`;

const FRAME: Omit<DocsLayoutProps, 'children'> = {
  sections: SECTIONS,
  activeHref: ACTIVE_HREF,
  homeHref: '/',
  homeLabel: 'Tale documentation home',
  navLabel: 'Documentation',
  search: {
    indexUrl: '/search-index-en.json',
    recentsStorageKey: 'tale.storybook.docs.recentSearches.v1',
  },
  footer: {
    legalLines: [
      '© 2026 Tale by Ruler GmbH',
      'Tale is MIT licensed — free to use, modify, and distribute.',
    ],
    baseUrl: '/',
    repositoryUrl: 'https://github.com/tale-project/tale',
  },
};

const meta = {
  title: 'Docs/DocsLayout',
  component: DocsLayout,
  parameters: {
    // The frame owns the whole viewport: rail, strip, article and footer.
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
The documentation frame both Tale docs sites render — the product docs and the
design-system guide. A site hands it a resolved navigation tree and renders
each page as a \`DocsHeader\` strip followed by a \`DocsArticle\`:

\`\`\`tsx
import { DocsArticle } from '@tale/ui/docs/docs-article';
import { DocsHeader } from '@tale/ui/docs/docs-header';
import { DocsLayout } from '@tale/ui/docs/docs-layout';
import { PageActions } from '@tale/ui/docs/page-actions';

<DocsLayout sections={nav} activeHref={path} homeHref="/" homeLabel="…" navLabel="…" search={search} footer={footer}>
  <DocsHeader crumbs={crumbs} actions={<PageActions markdownUrl={md} markdown={raw} />} />
  <DocsArticle title={title} readingTimeMinutes={4} toc={toc} prev={prev} next={next}>
    {body}
  </DocsArticle>
</DocsLayout>
\`\`\`

The rail's logo row and the header strip are one \`h-13\` bar, border
included, so their bottom borders meet as one line whatever the strip holds.
        `,
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof DocsLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Page: Story = {
  args: { ...FRAME, children: null },
  render: (args) => (
    <DocsLayout {...args}>
      <DocsHeader
        crumbs={[
          { label: 'Home', href: '/' },
          { label: 'Self-hosted', href: '/self-hosted' },
          { label: 'Install' },
          { label: 'Run your first self-hosted instance' },
        ]}
        actions={
          <PageActions
            markdownUrl="https://docs.tale.dev/self-hosted/install/quickstart.md"
            markdown="# Run your first self-hosted instance"
          />
        }
      />
      <DocsArticle
        title="Run your first self-hosted instance"
        description="Start Tale on one machine, create the first account, and connect a model provider."
        readingTimeMinutes={6}
        updatedAt="15 Sept 2026"
        toc={extractToc(BODY)}
        prev={{
          href: '/self-hosted',
          label: 'Run Tale on your infrastructure',
        }}
        next={{
          href: '/self-hosted/install/cli-install',
          label: 'Deploy with the CLI',
        }}
        editHref="https://github.com/tale-project/tale/edit/main/docs/en/self-hosted/install/quickstart.md"
      >
        <Markdown components={markdownComponents}>{BODY}</Markdown>
      </DocsArticle>
    </DocsLayout>
  ),
};

export const NotFound: Story = {
  args: { ...FRAME, activeHref: '/nope', children: null },
  render: (args) => (
    <DocsLayout {...args}>
      <DocsNotFound
        home={{ href: '/', label: 'Home' }}
        suggestions={[
          {
            href: '/self-hosted/install/quickstart',
            label: 'Self Hosted / Install / Quickstart',
          },
          {
            href: '/self-hosted/install/cli-install',
            label: 'Self Hosted / Install / Cli Install',
          },
        ]}
      />
    </DocsLayout>
  ),
};

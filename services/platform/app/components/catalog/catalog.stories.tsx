import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Bot, LayoutGrid, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';

import {
  CatalogCardSkeleton,
  CatalogGridSkeleton,
} from './catalog-card-skeleton';
import { CatalogCard, CatalogCardIcon, CatalogGrid } from './catalog-grid';
import { CatalogLabels } from './catalog-labels';
import { CatalogSection, groupCatalogItems } from './catalog-section';
import { CatalogToolbar } from './catalog-toolbar';
import { CatalogView } from './catalog-view';

const ROWS = [
  { slug: 'github', description: 'Issues, pull requests, and reviews.' },
  { slug: 'slack', description: 'Channels, threads, and direct messages.' },
  { slug: 'gmail', description: 'Read, label, and send mail.' },
];

const meta: Meta = {
  title: 'Catalog/Catalog',
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
The shared catalog design every browse-and-act surface composes (automations
hub, agent catalog, connectors, skills): one toolbar row, one card anatomy,
one folder-section shape, one loading skeleton.

## Usage
\`\`\`tsx
import { CatalogToolbar } from '@/app/components/catalog/catalog-toolbar';
import { CatalogCard, CatalogCardIcon, CatalogGrid } from '@/app/components/catalog/catalog-grid';
import { CatalogSection, folderLabel, groupCatalogItems } from '@/app/components/catalog/catalog-section';
import { CatalogGridSkeleton } from '@/app/components/catalog/catalog-card-skeleton';
import { useCatalogSearch } from '@/app/components/catalog/use-catalog-search';
\`\`\`

Slot rules: the \`badge\` slot owns install/liveness state badges (dot only on
liveness, e.g. Connected); the \`meta\` slot owns quiet labels under the title;
the \`description\` is text-only and full-bleed under the icon+title row.
        `,
      },
    },
  },
};

export default meta;

export const CardAnatomy: StoryObj = {
  render: () => (
    <div className="max-w-sm">
      <CatalogCard
        media={
          <CatalogCardIcon>
            <Bot className="text-muted-foreground size-5" />
          </CatalogCardIcon>
        }
        title="Sales Rep"
        description="Handles outbound outreach and keeps the pipeline tidy."
        badge={<Badge variant="green">Installed</Badge>}
        meta={
          <CatalogLabels labels={['Sales', 'Requires GitHub']} tone="quiet" />
        }
        actions={
          <>
            <Button variant="secondary">Open</Button>
            <Button variant="ghost">Uninstall</Button>
          </>
        }
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Full card anatomy: media tile, title, state badge, meta chips, text-only description, footer actions.',
      },
    },
  },
};

export const BadgeStates: StoryObj = {
  render: () => (
    <CatalogGrid>
      <CatalogCard
        media={
          <CatalogCardIcon>
            <LayoutGrid className="text-muted-foreground size-5" />
          </CatalogCardIcon>
        }
        title="Not installed"
        description="No state badge — the Install action is the signal."
        actions={<Button>Install</Button>}
      />
      <CatalogCard
        media={
          <CatalogCardIcon>
            <LayoutGrid className="text-muted-foreground size-5" />
          </CatalogCardIcon>
        }
        title="Installed"
        description="Healthy install — green state badge, no dot."
        badge={<Badge variant="green">Installed</Badge>}
        actions={<Button variant="secondary">Open</Button>}
      />
      <CatalogCard
        media={
          <CatalogCardIcon>
            <LayoutGrid className="text-muted-foreground size-5" />
          </CatalogCardIcon>
        }
        title="Finish setup"
        description="Installed but blocked on a required connector."
        badge={<Badge variant="yellow">Finish setup</Badge>}
        actions={<Button variant="secondary">Open</Button>}
      />
      <CatalogCard
        media={
          <CatalogCardIcon>
            <LayoutGrid className="text-muted-foreground size-5" />
          </CatalogCardIcon>
        }
        title="Broken"
        description="Bundle files drifted or failed to read."
        badge={<Badge variant="destructive">Reinstall</Badge>}
        actions={<Button variant="secondary">Open</Button>}
      />
      <CatalogCard
        media={
          <CatalogCardIcon>
            <LayoutGrid className="text-muted-foreground size-5" />
          </CatalogCardIcon>
        }
        title="Connected"
        description="Liveness badge — the only badge that carries a dot."
        badge={
          <Badge variant="green" dot>
            Connected
          </Badge>
        }
      />
      <CatalogCard
        media={
          <CatalogCardIcon>
            <LayoutGrid className="text-muted-foreground size-5" />
          </CatalogCardIcon>
        }
        title="Private upload"
        description="Uploaded bundle — slate Private badge next to the state."
        badge={
          <>
            <Badge variant="slate">Private</Badge>
            <Badge variant="green">Installed</Badge>
          </>
        }
        actions={<Button variant="secondary">Open</Button>}
      />
    </CatalogGrid>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Badge policy: install-state badges (Installed / Finish setup / Reinstall) have no dot; the dot is reserved for liveness (Connected). Not-installed cards carry no badge.',
      },
    },
  },
};

export const ToolbarWithTabs: StoryObj = {
  render: function Render() {
    const [tab, setTab] = useState('installed');
    const [search, setSearch] = useState('');
    return (
      <CatalogToolbar
        tabs={{
          items: [
            { value: 'installed', label: 'Installed' },
            { value: 'all', label: 'All' },
          ],
          value: tab,
          onValueChange: setTab,
        }}
        search={{
          value: search,
          onChange: (e) => setSearch(e.target.value),
          placeholder: 'Search…',
        }}
        action={
          <Button>
            <Plus className="size-4" />
            Add
          </Button>
        }
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'With tabs the pill strip leads and the search right-aligns beside the action slot.',
      },
    },
  },
};

export const ToolbarWithoutTabs: StoryObj = {
  render: function Render() {
    const [search, setSearch] = useState('');
    return (
      <CatalogToolbar
        search={{
          value: search,
          onChange: (e) => setSearch(e.target.value),
          placeholder: 'Search…',
        }}
        action={
          <Button>
            <Plus className="size-4" />
            Add
          </Button>
        }
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Without tabs the search leads; the action stays right-aligned.',
      },
    },
  },
};

const SECTION_ITEMS = [
  { name: 'Issue Desk', folder: 'github' },
  { name: 'Release Notes', folder: 'github' },
  { name: 'Support Copilot', folder: 'chat' },
  { name: 'Odds and Ends', folder: '' },
];

export const Sections: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-6">
      {groupCatalogItems(SECTION_ITEMS, (i) => i.folder).map(
        ([folder, items]) => (
          <CatalogSection
            key={folder}
            title={folder === '' ? 'General' : folder.toUpperCase()}
          >
            <CatalogGrid>
              {items.map((item) => (
                <CatalogCard
                  key={item.name}
                  media={
                    <CatalogCardIcon>
                      <Sparkles className="text-muted-foreground size-5" />
                    </CatalogCardIcon>
                  }
                  title={item.name}
                  description="Grouped by its manifest folder."
                />
              ))}
            </CatalogGrid>
          </CatalogSection>
        ),
      )}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Folder sections: real <h3> captions, folders sorted alphabetically, the ungrouped bucket trailing last.',
      },
    },
  },
};

export const Skeleton: StoryObj = {
  render: () => (
    <Skeletonize loading label="Catalog">
      <CatalogGridSkeleton cards={3} footer />
    </Skeletonize>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The shared loading grid — render inside a Skeletonize so one wrapper announces the loading region.',
      },
    },
  },
};

export const SkeletonCardOnly: StoryObj = {
  render: () => (
    <Skeletonize loading label="Card">
      <div className="grid max-w-2xl grid-cols-2 gap-4">
        <CatalogCardSkeleton />
        <CatalogCardSkeleton footer />
      </div>
    </Skeletonize>
  ),
  parameters: {
    docs: {
      description: {
        story: 'One placeholder card, without and with the footer bar.',
      },
    },
  },
};

export const ToolbarWithFilters: StoryObj = {
  render: function ToolbarWithFiltersStory() {
    const [tab, setTab] = useState('all');
    const [query, setQuery] = useState('');
    return (
      <CatalogToolbar
        tabs={{
          items: [
            { value: 'all', label: 'All' },
            { value: 'connected', label: 'Connected' },
            { value: 'available', label: 'Available' },
          ],
          value: tab,
          onValueChange: setTab,
        }}
        search={{
          value: query,
          onChange: (e) => setQuery(e.target.value),
          placeholder: 'Search connectors…',
        }}
        filters={
          <Button variant="secondary" size="sm">
            Tags
          </Button>
        }
        action={
          <Button icon={Plus} size="sm">
            Add connector
          </Button>
        }
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Facets go in `filters`, beside the search that does the same narrowing job. `action` keeps the surface’s primary verb apart from them.',
      },
    },
  },
};

export const ViewStates: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-10">
      {(
        [
          ['Loading', { isPending: true, items: ROWS, hasItems: true }],
          ['Loaded', { isPending: false, items: ROWS, hasItems: true }],
          [
            'Listing failed',
            {
              isPending: false,
              isError: true,
              errorMessage:
                'Could not load the connectors: catalog root missing',
              items: [],
              hasItems: false,
            },
          ],
          [
            'Nothing yet (offers the CTA)',
            { isPending: false, items: [], hasItems: false },
          ],
          [
            'Nothing matches (no CTA)',
            { isPending: false, items: [], hasItems: true },
          ],
        ] as const
      ).map(([label, props]) => (
        <div key={label} className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs font-medium uppercase">
            {label}
          </p>
          <CatalogView<{ slug: string; description: string }>
            {...props}
            itemKey={(row) => row.slug}
            renderItem={(row) => (
              <CatalogCard
                media={
                  <CatalogCardIcon>
                    <Bot className="size-6" />
                  </CatalogCardIcon>
                }
                title={row.slug}
                headingLevel={3}
                description={row.description}
              />
            )}
            empty={{
              icon: LayoutGrid,
              title: 'No connectors yet',
              description: 'Connect a service to give your agents reach.',
              action: <Button size="sm">Add connector</Button>,
            }}
            skeletonCards={3}
          />
        </div>
      ))}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Every state a card catalog can be in. Note the two empty states differ: owning nothing offers the create CTA, filtering to nothing offers the search reset instead.',
      },
    },
  },
};

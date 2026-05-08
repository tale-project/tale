import type { Meta, StoryObj } from '@storybook/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { Box, Boxes, Cloud, ServerCog } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card, CardGroup } from './cards';

function withRouter(children: ReactNode) {
  const root = createRootRoute({ component: () => <>{children}</> });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return <RouterProvider router={router} />;
}

const meta = {
  title: 'webui/markdown/CardGroup',
  component: CardGroup,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CardGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Landing: Story = {
  render: () =>
    withRouter(
      <CardGroup cols={2}>
        <Card title="Cloud" icon={<Cloud className="size-4" />} href="/cloud">
          Tale managed in the EU or Switzerland — onboarding, billing, trust.
        </Card>
        <Card
          title="Self-hosted"
          icon={<ServerCog className="size-4" />}
          href="/self-hosted"
        >
          Run Tale on your own infrastructure with Docker Compose.
        </Card>
        <Card
          title="Platform"
          icon={<Boxes className="size-4" />}
          href="/platform"
        >
          Feature reference for chat, agents, automations, and the workspace.
        </Card>
        <Card
          title="Develop"
          icon={<Box className="size-4" />}
          href="/develop/api-reference"
        >
          API reference, webhooks, and integration patterns.
        </Card>
      </CardGroup>,
    ),
};

export const ThreeColumns: Story = {
  render: () =>
    withRouter(
      <CardGroup cols={3}>
        <Card title="One" href="/one">
          First column.
        </Card>
        <Card title="Two" href="/two">
          Second column.
        </Card>
        <Card title="Three" href="/three">
          Third column.
        </Card>
      </CardGroup>,
    ),
};

// Mintlify-style: icon prop is a kebab-case Lucide name string.
export const StringIcons: Story = {
  render: () =>
    withRouter(
      <CardGroup cols={2}>
        <Card title="Cloud" icon="cloud" href="/cloud">
          Resolves the kebab-case Lucide name at runtime.
        </Card>
        <Card title="Server" icon="server-cog" href="/self-hosted">
          Useful when authored in plain markdown.
        </Card>
        <Card title="Unknown icon" icon="not-a-real-icon" href="/x">
          Unknown names fall back to no icon (no crash).
        </Card>
      </CardGroup>,
    ),
};

export const ExternalLink: Story = {
  render: () =>
    withRouter(
      <CardGroup cols={1}>
        <Card title="GitHub" href="https://github.com/tale-project/tale">
          Source on GitHub.
        </Card>
      </CardGroup>,
    ),
};

// Title-less + children-less cards should render gracefully.
export const Empty: Story = {
  render: () =>
    withRouter(
      <CardGroup cols={2}>
        <Card title="" href="/empty-title">
          A card with an empty title still renders its description.
        </Card>
        <Card title="No body" href="/no-body" />
      </CardGroup>,
    ),
};

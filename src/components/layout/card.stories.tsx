import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { ArrowUpRight, Boxes, Plug } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardGrid,
  CardHeader,
  CardMedia,
  CardTitle,
} from './card';

const meta: Meta<typeof Card> = {
  title: 'Layout/Card',
  component: Card,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
The one bordered surface primitive. Compose it with the \`Card*\` subcomponents and
drive its look with \`padding\` / \`radius\` / \`shadow\` / \`interactive\`. Use \`asChild\`
to turn the card into a \`<button>\`, \`<a>\`, or router \`<Link>\`.

\`\`\`tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@tale/ui/card';

<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Description</CardDescription>
  </CardHeader>
  <CardContent>Body</CardContent>
</Card>
\`\`\`
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-full max-w-md">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Card>;

/** The classic composed card: header (title + description), content, footer. */
export const Basic: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Create project</CardTitle>
        <CardDescription>Deploy your new project in one click.</CardDescription>
      </CardHeader>
      <CardContent className="text-fg-muted mt-4 text-sm">
        Your project will be deployed to our cloud infrastructure.
      </CardContent>
      <CardFooter className="mt-6 justify-end">
        <Button variant="secondary">Cancel</Button>
        <Button>Deploy</Button>
      </CardFooter>
    </Card>
  ),
};

/** Every padding step crossed with both radii. */
export const PaddingAndRadius: Story = {
  decorators: [],
  render: () => (
    <div className="grid w-full max-w-3xl grid-cols-2 gap-4">
      {(['sm', 'md', 'lg', 'xl'] as const).map((padding) =>
        (['lg', 'xl'] as const).map((radius) => (
          <Card key={`${padding}-${radius}`} padding={padding} radius={radius}>
            <span className="text-fg-muted text-sm">
              padding=&quot;{padding}&quot; radius=&quot;{radius}&quot;
            </span>
          </Card>
        )),
      )}
    </div>
  ),
};

/** `asChild` + `interactive` turns the whole card into a focusable button. */
export const Interactive: Story = {
  render: () => (
    <Card asChild interactive padding="md">
      <button type="button" className="w-full text-left">
        <CardHeader>
          <CardTitle>Clickable card</CardTitle>
          <CardDescription>The whole surface is the button.</CardDescription>
        </CardHeader>
      </button>
    </Card>
  ),
};

/** `asChild` around an anchor — a card that navigates. */
export const AsLink: Story = {
  render: () => (
    <Card asChild interactive padding="md" className="group">
      <a href="https://example.com" target="_blank" rel="noopener noreferrer">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Documentation</CardTitle>
            <ArrowUpRight className="text-fg-muted size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>
          <CardDescription>Opens in a new tab.</CardDescription>
        </CardHeader>
      </a>
    </Card>
  ),
};

/** A leading 40px `CardMedia` tile + title + description. */
export const WithMedia: Story = {
  render: () => (
    <Card padding="md">
      <div className="flex items-start gap-3">
        <CardMedia>
          <Boxes className="text-fg-base size-5" />
        </CardMedia>
        <CardHeader>
          <CardTitle>Inventory</CardTitle>
          <CardDescription>Track products and stock levels.</CardDescription>
        </CardHeader>
      </div>
    </Card>
  ),
};

/** The browse-and-act catalog layout (media + title + badge + description + meta + actions). */
export const Catalog: Story = {
  render: () => (
    <Card padding="md" className="flex h-full flex-col">
      <div className="flex items-start gap-3">
        <CardMedia>
          <Plug className="text-fg-base size-5" />
        </CardMedia>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="line-clamp-1 text-sm">Slack</CardTitle>
            <Badge variant="green" dot className="shrink-0">
              Connected
            </Badge>
          </div>
          <CardDescription className="line-clamp-2 leading-snug">
            Send and receive messages from your workspace.
          </CardDescription>
        </div>
      </div>
      <CardFooter className="mt-auto pt-4">
        <Button variant="secondary" size="sm">
          Manage
        </Button>
      </CardFooter>
    </Card>
  ),
};

/** The chat approval frame: `padding="md"` + `radius="xl"`. */
export const ApprovalFrame: Story = {
  render: () => (
    <Card padding="md" radius="xl" className="overflow-hidden">
      <CardHeader>
        <CardTitle className="text-sm">Save 2 documents?</CardTitle>
        <CardDescription>report.md, summary.md</CardDescription>
      </CardHeader>
      <CardFooter className="mt-4 justify-end">
        <Button variant="secondary" size="sm">
          Reject
        </Button>
        <Button size="sm">Approve</Button>
      </CardFooter>
    </Card>
  ),
};

/** `CardGrid` lays out cards 1 → 2 → 3 columns responsively. */
export const CardGridStory: Story = {
  name: 'Card grid',
  decorators: [],
  render: () => (
    <CardGrid className="w-full max-w-4xl">
      {['Agents', 'Workflows', 'Connectors'].map((label) => (
        <Card key={label} padding="md">
          <CardTitle className="text-sm">{label}</CardTitle>
          <CardDescription className="mt-1">
            Browse and install from the catalog.
          </CardDescription>
        </Card>
      ))}
    </CardGrid>
  ),
};

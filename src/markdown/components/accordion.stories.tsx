import type { Meta, StoryObj } from '@storybook/react';

import { Accordion, AccordionGroup } from './accordion';

const meta = {
  title: 'markdown/Accordion',
  component: Accordion,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Accordion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleClosed: Story = {
  args: {
    title: 'Why does the docs site have a fallback locale?',
    children:
      'When a regional locale (e.g. de-CH) doesn’t override a page, the loader falls through to the base locale and finally to en.',
  },
};

export const SingleOpen: Story = {
  args: {
    title: 'Open by default',
    defaultOpen: true,
    children: 'Set defaultOpen to render the panel expanded on first paint.',
  },
};

export const RichContent: Story = {
  args: {
    title: 'Embedded markdown content',
    defaultOpen: true,
    children: (
      <div className="space-y-2">
        <p>
          The panel accepts arbitrary children, including paragraphs, lists, and
          inline <code>code</code>.
        </p>
        <ul className="list-disc pl-5">
          <li>Bullet one</li>
          <li>Bullet two</li>
        </ul>
      </div>
    ),
  },
};

export const Group: StoryObj<typeof meta> = {
  args: { title: '' },
  render: () => (
    <AccordionGroup>
      <Accordion title="What does Tale do?">
        Sovereign AI platform for data-sensitive organisations.
      </Accordion>
      <Accordion title="Where can I host it?">
        Switzerland, EU, or your own infrastructure.
      </Accordion>
      <Accordion title="Is it open source?">
        Yes — see the GitHub repo for the source.
      </Accordion>
    </AccordionGroup>
  ),
};

export const GroupWithDefaultOpen: StoryObj<typeof meta> = {
  args: { title: '' },
  render: () => (
    <AccordionGroup>
      <Accordion title="First item">First panel content.</Accordion>
      <Accordion title="Second item (open by default)" defaultOpen>
        Only one accordion can be open at a time within a group.
      </Accordion>
      <Accordion title="Third item">Third panel content.</Accordion>
    </AccordionGroup>
  ),
};

import type { Meta, StoryObj } from '@storybook/react';

import { Accordion, AccordionGroup } from './accordion';

const meta = {
  title: 'webui/markdown/Accordion',
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
      'When a regional locale (de-CH, de-AT, fr-CH) doesn’t override a page, the loader falls through to the base locale (de or fr) and finally to en.',
  },
};

export const SingleOpen: Story = {
  args: {
    title: 'Open by default',
    defaultOpen: true,
    children: 'Set defaultOpen to render the panel expanded on first paint.',
  },
};

export const Group: StoryObj = {
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

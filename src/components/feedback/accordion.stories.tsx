import type { Meta, StoryObj } from '@storybook/react-vite';

import { Accordion, AccordionItem } from './accordion';

const meta: Meta<typeof Accordion> = {
  title: 'Feedback/Accordion',
  component: Accordion,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof Accordion>;

const items = [
  {
    id: 'what',
    q: 'What is Tale?',
    a: 'An AI platform for your company.',
  },
  {
    id: 'who',
    q: 'Who is it for?',
    a: 'Teams who want to delegate work to agents.',
  },
  {
    id: 'how',
    q: 'How do I start?',
    a: 'Run the setup wizard and connect a provider.',
  },
];

/** `single` (default) — opening one item closes the others. */
export const Single: Story = {
  render: () => (
    <div className="max-w-xl">
      <Accordion type="single" defaultOpen="what">
        {items.map((it) => (
          <AccordionItem key={it.id} id={it.id} question={it.q}>
            {it.a}
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  ),
};

/** `multiple` — items open and close independently. */
export const Multiple: Story = {
  render: () => (
    <div className="max-w-xl">
      <Accordion type="multiple" defaultOpen={['what', 'how']}>
        {items.map((it) => (
          <AccordionItem key={it.id} id={it.id} question={it.q}>
            {it.a}
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  ),
};

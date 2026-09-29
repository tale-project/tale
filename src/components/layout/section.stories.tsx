import type { Meta, StoryObj } from '@storybook/react-vite';

import { Container } from './container';
import { Section } from './section';

const meta: Meta<typeof Section> = {
  title: 'Layout/Section',
  component: Section,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Section>;

export const Tones: Story = {
  render: () => (
    <>
      {(['default', 'muted', 'inverse'] as const).map((tone) => (
        <Section key={tone} tone={tone} spacing="sm">
          <Container>
            <p className="text-center text-sm">tone=&quot;{tone}&quot;</p>
          </Container>
        </Section>
      ))}
    </>
  ),
};

export const Spacing: Story = {
  render: () => (
    <>
      {(['sm', 'md', 'lg'] as const).map((spacing) => (
        <Section
          key={spacing}
          spacing={spacing}
          tone={spacing === 'md' ? 'muted' : 'default'}
        >
          <Container>
            <p className="text-center text-sm">spacing=&quot;{spacing}&quot;</p>
          </Container>
        </Section>
      ))}
    </>
  ),
};

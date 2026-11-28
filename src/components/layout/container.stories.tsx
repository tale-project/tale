import type { Meta, StoryObj } from '@storybook/react-vite';

import { Container } from './container';

const meta: Meta<typeof Container> = {
  title: 'Layout/Container',
  component: Container,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Container>;

const Band = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-primary/10 border-primary/20 rounded-md border p-4 text-center text-sm">
    {children}
  </div>
);

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4 py-6">
      {(['md', 'lg', 'xl', 'full'] as const).map((size) => (
        <Container key={size} size={size}>
          <Band>size=&quot;{size}&quot;</Band>
        </Container>
      ))}
    </div>
  ),
};

export const Default: Story = {
  render: () => (
    <div className="py-6">
      <Container>
        <Band>Default container (xl, centered, responsive padding)</Band>
      </Container>
    </div>
  ),
};

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Image } from './image';

const SAMPLE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='100'%3E%3Crect width='160' height='100' fill='%237c9cf5'/%3E%3C/svg%3E";
const FALLBACK =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='100'%3E%3Crect width='160' height='100' fill='%23e2e8f0'/%3E%3C/svg%3E";

const meta: Meta<typeof Image> = {
  title: 'Primitives/Image',
  component: Image,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof Image>;

export const Default: Story = {
  render: () => (
    <Image
      src={SAMPLE}
      alt="A sample banner"
      className="rounded-md"
      width={160}
      height={100}
    />
  ),
};

/** On load error the component swaps in `fallbackSrc`. */
export const ErrorFallback: Story = {
  render: () => (
    <Image
      src="https://invalid.example/missing.png"
      fallbackSrc={FALLBACK}
      alt="Falls back when the source is unreachable"
      className="rounded-md"
      width={160}
      height={100}
    />
  ),
};

/** A decorative image takes an empty `alt` so screen readers skip it. */
export const Decorative: Story = {
  render: () => (
    <Image
      src={SAMPLE}
      alt=""
      className="rounded-md"
      width={160}
      height={100}
    />
  ),
};

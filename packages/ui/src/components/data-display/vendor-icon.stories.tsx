import type { Meta, StoryObj } from '@storybook/react-vite';

import { VendorIcon } from './vendor-icon';

const meta: Meta<typeof VendorIcon> = {
  title: 'DataDisplay/VendorIcon',
  component: VendorIcon,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "A vendor's shipped icon, falling back to the plug glyph when there is none or it fails to load. Decorative: put the vendor's name beside it.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof VendorIcon>;

export const WithoutIcon: Story = { args: {} };

/** An image the browser cannot decode fails at once, without a request. */
export const BrokenIcon: Story = {
  args: { iconUrl: 'data:image/svg+xml,%3Csvg' },
};

export const Larger: Story = { args: { className: 'size-8' } };

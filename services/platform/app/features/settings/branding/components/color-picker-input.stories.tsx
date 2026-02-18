import type { Meta, StoryObj } from '@storybook/react';

import { useState } from 'react';
import { fn } from 'storybook/test';

import { ColorPickerInput } from './color-picker-input';

const meta: Meta<typeof ColorPickerInput> = {
  title: 'Settings/Branding/ColorPickerInput',
  component: ColorPickerInput,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    value: {
      control: 'text',
      description: 'Hex color value (e.g. #FF0000)',
    },
    label: {
      control: 'text',
      description: 'Label text for the color picker',
    },
  },
  args: {
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ColorPickerInput>;

export const Default: Story = {
  args: {
    value: '#000000',
    label: 'Brand color',
    id: 'brand-color',
  },
};

export const WithColor: Story = {
  args: {
    value: '#3366FF',
    label: 'Accent color',
    id: 'accent-color',
  },
};

export const InvalidHex: Story = {
  args: {
    value: '#ZZZ',
    label: 'Invalid color',
    id: 'invalid',
  },
  parameters: {
    docs: {
      description: {
        story: 'When an invalid hex value is provided, the swatch shows white.',
      },
    },
  },
};

function InteractiveRender() {
  const [color, setColor] = useState('#FF5500');
  return (
    <ColorPickerInput
      value={color}
      onChange={setColor}
      label="Pick a color"
      id="interactive"
    />
  );
}

export const Interactive: Story = {
  render: () => <InteractiveRender />,
  parameters: {
    docs: {
      description: {
        story: 'Fully interactive color picker with state management.',
      },
    },
  },
};

function AllColorsRender() {
  const [brand, setBrand] = useState('#1A1A2E');
  const [accent, setAccent] = useState('#E94560');
  return (
    <div className="flex flex-col gap-4">
      <ColorPickerInput
        value={brand}
        onChange={setBrand}
        label="Brand color"
        id="brand"
      />
      <ColorPickerInput
        value={accent}
        onChange={setAccent}
        label="Accent color"
        id="accent"
      />
    </div>
  );
}

export const AllColors: Story = {
  render: () => <AllColorsRender />,
  parameters: {
    docs: {
      description: {
        story: 'Multiple color pickers as they appear in the branding form.',
      },
    },
  },
};

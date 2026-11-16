import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Slider } from './slider';

const meta: Meta<typeof Slider> = {
  title: 'Forms/Slider',
  component: Slider,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof Slider>;

function SliderDemo({
  ticks,
  withValueLabel,
}: {
  ticks?: readonly number[];
  withValueLabel?: boolean;
}) {
  const [value, setValue] = useState(40);
  return (
    <div className="max-w-sm pt-10">
      <Slider
        aria-label="Temperature"
        value={value}
        min={0}
        max={100}
        ticks={ticks}
        valueLabel={withValueLabel ? value : undefined}
        onChange={(e) => setValue(e.currentTarget.valueAsNumber)}
      />
    </div>
  );
}

export const Default: Story = { render: () => <SliderDemo /> };

export const WithTicks: Story = {
  render: () => <SliderDemo ticks={[0, 25, 50, 75, 100]} />,
};

export const WithValueLabel: Story = {
  render: () => <SliderDemo withValueLabel />,
};

export const Disabled: Story = {
  render: () => (
    <div className="max-w-sm">
      <Slider
        aria-label="Disabled"
        value={30}
        min={0}
        max={100}
        disabled
        onChange={() => {}}
      />
    </div>
  ),
};

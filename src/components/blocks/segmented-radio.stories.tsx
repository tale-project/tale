import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { SegmentedRadio } from './segmented-radio';

const meta = {
  title: 'Blocks/SegmentedRadio',
  parameters: { layout: 'centered' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const BILLING_OPTIONS = ['Kauf', 'Leasing'] as const;

function BillingExample() {
  const [value, setValue] =
    useState<(typeof BILLING_OPTIONS)[number]>('Leasing');
  return (
    <SegmentedRadio
      ariaLabel="Billing"
      options={BILLING_OPTIONS}
      value={value}
      onChange={setValue}
      renderLabel={(option) => option}
    />
  );
}

/** Test actual glyph bounds: computed padding alone missed the overflow. */
async function expectLabelPadding(button: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(button);
  const label = range.getBoundingClientRect();
  const surface = button.getBoundingClientRect();
  const style = getComputedStyle(button);
  await expect(label.left - surface.left).toBeGreaterThanOrEqual(
    Number.parseFloat(style.paddingLeft) - 0.5,
  );
  await expect(surface.right - label.right).toBeGreaterThanOrEqual(
    Number.parseFloat(style.paddingRight) - 0.5,
  );
}

export const UnequalLabelLengths: Story = {
  render: () => <BillingExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const buying = canvas.getByRole('radio', { name: 'Kauf' });
    const leasing = canvas.getByRole('radio', { name: 'Leasing' });
    await expectLabelPadding(buying);
    await expectLabelPadding(leasing);
    await userEvent.click(buying);
    await expect(buying).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{End}');
    await expect(leasing).toHaveFocus();
    await expect(leasing).toHaveAttribute('aria-checked', 'true');
    await expectLabelPadding(leasing);
  },
};

export const NarrowContainer: Story = {
  render: () => (
    <div style={{ width: 208 }}>
      <SegmentedRadio
        ariaLabel="Hardware"
        options={['Einzelserver', 'Mehrere Server', 'Rack']}
        value="Mehrere Server"
        onChange={() => {}}
        renderLabel={(option) => option}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const group = canvas.getByRole('radiogroup');
    const bounds = group.getBoundingClientRect();
    await expect(bounds.width).toBeLessThanOrEqual(208);
    for (const button of canvas.getAllByRole('radio')) {
      await expectLabelPadding(button);
      const surface = button.getBoundingClientRect();
      await expect(surface.left).toBeGreaterThanOrEqual(bounds.left);
      await expect(surface.right).toBeLessThanOrEqual(bounds.right);
    }
  },
};

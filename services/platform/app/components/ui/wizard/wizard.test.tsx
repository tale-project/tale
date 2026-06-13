import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen, waitFor } from '@/test/utils/render';

import type { WizardBeforeNext, WizardStepMeta } from './use-wizard';
import { Wizard, WizardStep } from './wizard';
import { WizardFooter } from './wizard-footer';
import { WizardProgress } from './wizard-progress';

const STEPS: WizardStepMeta[] = [
  { id: 'one', label: 'One' },
  { id: 'two', label: 'Two', optional: true },
  { id: 'three', label: 'Three' },
];

const fmt = (current: number, total: number, label: string) =>
  `Step ${current} of ${total}: ${label}`;

function Harness({
  onFinish = vi.fn(),
  beforeNextOne,
}: {
  onFinish?: () => void;
  beforeNextOne?: WizardBeforeNext;
}) {
  return (
    <Wizard steps={STEPS} onFinish={onFinish} formatProgress={fmt}>
      <WizardProgress ariaLabel="Steps" />
      <WizardStep id="one" onBeforeNext={beforeNextOne}>
        <p>Content one</p>
      </WizardStep>
      <WizardStep id="two">
        <p>Content two</p>
      </WizardStep>
      <WizardStep id="three">
        <p>Content three</p>
      </WizardStep>
      <WizardFooter
        backLabel="Back"
        nextLabel="Next"
        finishLabel="Finish"
        skipLabel="Skip"
      />
    </Wizard>
  );
}

describe('Wizard navigation', () => {
  it('starts on the first step with no Back button', () => {
    render(<Harness />);
    expect(screen.getByText('Content one')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Back' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('advances with Next and returns with Back', async () => {
    const { user } = render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Content two')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Content one')).toBeInTheDocument();
  });

  it('shows Finish on the last step and calls onFinish', async () => {
    const onFinish = vi.fn();
    const { user } = render(<Harness onFinish={onFinish} />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    const finish = await screen.findByRole('button', { name: 'Finish' });
    await user.click(finish);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});

describe('Wizard validation gating', () => {
  function GatedHarness() {
    const [value, setValue] = useState('');
    const steps: WizardStepMeta[] = [
      { id: 'name', label: 'Name' },
      { id: 'done', label: 'Done' },
    ];
    return (
      <Wizard steps={steps} onFinish={vi.fn()} formatProgress={fmt}>
        <WizardStep id="name" valid={value.length > 0}>
          <label htmlFor="n">Name</label>
          <input
            id="n"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </WizardStep>
        <WizardStep id="done">
          <p>Done content</p>
        </WizardStep>
        <WizardFooter backLabel="Back" nextLabel="Next" finishLabel="Finish" />
      </Wizard>
    );
  }

  it('disables Next until the active step is valid', async () => {
    const { user } = render(<GatedHarness />);
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 'Acme');
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });
});

describe('Wizard skip', () => {
  it('renders Skip only on optional steps and advances past them', async () => {
    const { user } = render(<Harness />);
    // Step one is required → no Skip.
    expect(
      screen.queryByRole('button', { name: 'Skip' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    // Step two is optional → Skip present.
    const skip = await screen.findByRole('button', { name: 'Skip' });
    await user.click(skip);
    expect(await screen.findByText('Content three')).toBeInTheDocument();
  });
});

describe('Wizard onBeforeNext', () => {
  it('blocks advance when the handler returns false', async () => {
    const beforeNextOne = vi.fn().mockResolvedValue(false);
    const { user } = render(<Harness beforeNextOne={beforeNextOne} />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(beforeNextOne).toHaveBeenCalled());
    // Still on step one.
    expect(screen.getByText('Content one')).toBeInTheDocument();
  });

  it('advances when the handler returns true', async () => {
    const beforeNextOne = vi.fn().mockResolvedValue(true);
    const { user } = render(<Harness beforeNextOne={beforeNextOne} />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Content two')).toBeInTheDocument();
  });
});

describe('Wizard accessibility', () => {
  it('has no axe violations and marks the active step', async () => {
    const { container } = render(<Harness />);
    expect(screen.getByRole('button', { name: /One/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
    await checkAccessibility(container);
  });
});

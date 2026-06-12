import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { Input } from '../forms/input';
import type { WizardStepMeta } from './use-wizard';
import { Wizard, WizardStep } from './wizard';
import { WizardFooter } from './wizard-footer';
import { WizardProgress } from './wizard-progress';

// Stories use literal strings on purpose — Storybook renders outside the app's
// translation flow, and these labels are illustrative.
const STEPS: WizardStepMeta[] = [
  { id: 'profile', label: 'Workspace' },
  { id: 'provider', label: 'AI provider', optional: true },
  { id: 'invite', label: 'Team', optional: true },
  { id: 'finish', label: 'Finish' },
];

const meta: Meta<typeof Wizard> = {
  title: 'Wizard/Wizard',
  component: Wizard,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A host-agnostic multi-step wizard. Compose `WizardProgress`, ' +
          '`WizardStep`s, and `WizardFooter` inside any shell. Next is gated ' +
          'on per-step validity; optional steps render a Skip action.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Wizard>;

function Shell({
  defaultActiveIndex = 0,
  steps = STEPS,
}: {
  defaultActiveIndex?: number;
  steps?: WizardStepMeta[];
}) {
  return (
    <div className="bg-bg-base ring-border-strong mx-auto max-w-xl rounded-xl p-6 shadow-sm ring-1">
      <Wizard
        steps={steps}
        defaultActiveIndex={defaultActiveIndex}
        onFinish={() => window.alert('Finished!')}
      >
        <WizardProgress ariaLabel="Setup steps" />
        {steps.map((step) => (
          <WizardStep key={step.id} id={step.id}>
            <h2 className="text-fg-base text-base font-medium">{step.label}</h2>
            <p className="text-fg-muted text-sm">
              Placeholder content for the “{step.label}” step.
            </p>
          </WizardStep>
        ))}
        <WizardFooter
          backLabel="Back"
          nextLabel="Next"
          finishLabel="Finish"
          skipLabel="Skip"
        />
      </Wizard>
    </div>
  );
}

export const Default: Story = {
  render: () => <Shell />,
};

export const MiddleStep: Story = {
  name: 'Middle step (Back + Skip + Next)',
  render: () => <Shell defaultActiveIndex={1} />,
};

export const LastStep: Story = {
  name: 'Last step (Finish)',
  render: () => <Shell defaultActiveIndex={3} />,
};

export const WithValidationError: Story = {
  name: 'Validation gating (Next disabled)',
  render: function ValidationStory() {
    const [value, setValue] = useState('');
    const steps: WizardStepMeta[] = [
      { id: 'name', label: 'Name' },
      { id: 'done', label: 'Done' },
    ];
    const valid = value.trim().length > 0;
    return (
      <div className="bg-bg-base ring-border-strong mx-auto max-w-xl rounded-xl p-6 shadow-sm ring-1">
        <Wizard steps={steps} onFinish={() => window.alert('Finished!')}>
          <WizardProgress ariaLabel="Setup steps" />
          <WizardStep id="name" valid={valid}>
            <Input
              label="Workspace name"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              errorMessage={
                valid ? undefined : 'A name is required to continue.'
              }
            />
          </WizardStep>
          <WizardStep id="done">
            <p className="text-fg-muted text-sm">All set.</p>
          </WizardStep>
          <WizardFooter
            backLabel="Back"
            nextLabel="Next"
            finishLabel="Finish"
          />
        </Wizard>
      </div>
    );
  },
};

export const AsyncStep: Story = {
  name: 'Async advance (spinner while saving)',
  render: function AsyncStory() {
    const steps: WizardStepMeta[] = [
      { id: 'save', label: 'Save' },
      { id: 'done', label: 'Done' },
    ];
    return (
      <div className="bg-bg-base ring-border-strong mx-auto max-w-xl rounded-xl p-6 shadow-sm ring-1">
        <Wizard steps={steps} onFinish={() => window.alert('Finished!')}>
          <WizardProgress ariaLabel="Setup steps" />
          <WizardStep
            id="save"
            onBeforeNext={async () => {
              await new Promise((r) => setTimeout(r, 1200));
              return true;
            }}
          >
            <p className="text-fg-muted text-sm">
              Clicking Next runs an async save; the button shows a spinner until
              it resolves.
            </p>
          </WizardStep>
          <WizardStep id="done">
            <p className="text-fg-muted text-sm">Saved.</p>
          </WizardStep>
          <WizardFooter
            backLabel="Back"
            nextLabel="Next"
            finishLabel="Finish"
          />
        </Wizard>
      </div>
    );
  },
};

export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => <Shell defaultActiveIndex={1} />,
};

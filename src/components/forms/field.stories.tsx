import type { Meta, StoryObj } from '@storybook/react-vite';

import { Field } from './field';
import { Input } from './input';

const meta: Meta<typeof Field> = {
  title: 'Forms/Field',
  component: Field,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof Field>;

export const Default: Story = {
  render: () => (
    <div className="max-w-sm">
      <Field label="Workspace name" htmlFor="ws">
        <Input id="ws" placeholder="Acme Inc." />
      </Field>
    </div>
  ),
};

export const WithDescription: Story = {
  render: () => (
    <div className="max-w-sm">
      <Field
        label="Email"
        htmlFor="email"
        description="We'll only use this to send sign-in links."
      >
        <Input id="email" type="email" placeholder="you@example.com" />
      </Field>
    </div>
  ),
};

export const Required: Story = {
  render: () => (
    <div className="max-w-sm">
      <Field label="API key" htmlFor="key" required>
        <Input id="key" placeholder="sk-…" />
      </Field>
    </div>
  ),
};

/** The error message is wired via `aria-describedby` + `aria-invalid` and `role="alert"`. */
export const WithError: Story = {
  render: () => (
    <div className="max-w-sm">
      <Field label="Email" htmlFor="email-err" error="Enter a valid email.">
        <Input id="email-err" defaultValue="not-an-email" />
      </Field>
    </div>
  ),
};

/**
 * Problems a check found: one line each under the control, describing it.
 * An error marks the control invalid; a warning does not. Never an alert.
 */
export const WithIssues: Story = {
  render: () => (
    <div className="max-w-sm">
      <Field
        label="Prompt"
        htmlFor="prompt-issues"
        description="What the agent is asked to do."
        issues={[
          {
            id: 'unknown-node',
            severity: 'error',
            message: 'Reads "nope", and there is no node with that id.',
          },
          {
            id: 'maybe-empty',
            severity: 'warning',
            message: 'Can be empty when the triage is skipped.',
          },
        ]}
      >
        <Input
          id="prompt-issues"
          defaultValue="Reply to {{ nodes.nope.output }}"
        />
      </Field>
    </div>
  ),
};

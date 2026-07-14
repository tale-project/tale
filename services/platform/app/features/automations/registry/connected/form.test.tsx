// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AutomationConfigField } from '@/lib/shared/schemas/automation_views';

import type { BoundActionSpec } from './bound-button';
import { Form } from './form';

// i18n → echo `<ns>.<key>` (params interpolated) so assertions read clearly.
vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (
      key: string,
      params?: Record<string, string> & { defaultValue?: string },
    ) => {
      if (params && Object.keys(params).length === 1 && params.defaultValue) {
        // BoundButton-style dynamic labelKey lookup: echo the key.
        return `${ns}.${key}`;
      }
      return params
        ? Object.entries(params).reduce(
            (acc, [k, v]) => acc.replace(`{${k}}`, v),
            `${ns}.${key}`,
          )
        : `${ns}.${key}`;
    },
  }),
}));

// The runtime carries the allowlist the REAL isFunctionAllowed gate checks,
// plus config for resolving `$config:` sentinels in `initial` via the REAL
// resolver.
vi.mock('../../runtime/automation-runtime', () => ({
  useAutomationRuntime: () => ({
    organizationId: 'org1',
    automationSlug: 'demo',
    allowlist: [{ path: 'tasks/mutations:createTask', mode: 'mutation' }],
    config: { repo: 'tale-repo' },
    projectName: 'SoftInstall Pro Ltd',
  }),
}));

// View-authored fields resolve via `useConfigFieldText` (field.i18n →
// literal → humanized `key`, e.g. `title` → `Title`).
vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: 'en' }),
}));

vi.mock('../../runtime/view-state', () => ({
  useOptionalViewState: () => null,
}));

// Optional `when`/`whenQuery` gate — unused in these fixtures; stub so the
// hook never reaches Convex.
vi.mock('../../hooks/use-bound-query', () => ({
  useBoundQuery: () => ({
    data: undefined,
    isLoading: false,
    error: null,
    blocked: false,
    needsConfig: false,
  }),
}));

// The bound dispatch — captured per test.
const dispatch = vi.fn<
  (
    args: unknown,
    selected?: Record<string, unknown>,
    ctx?: { input?: Record<string, unknown> },
  ) => Promise<unknown>
>(async () => ({ id: 'created1' }));
let isPending = false;
vi.mock('../../hooks/use-bound-action', () => ({
  useBoundAction: () => ({ dispatch, isPending }),
}));

const applyEffect = vi.fn();
vi.mock('../../runtime/action-effects', () => ({
  useActionEffect: () => applyEffect,
}));

// Stand in for the Radix select (portals are flaky in jsdom): one button per
// option firing onValueChange.
vi.mock('@/app/components/ui/forms/select', () => ({
  Select: ({
    options,
    onValueChange,
    value,
  }: {
    options: { value: string; label: string }[];
    onValueChange?: (v: string) => void;
    value?: string;
  }) => (
    <div data-testid="select" data-value={value ?? ''}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onValueChange?.(o.value)}
        >
          {`opt:${o.label}`}
        </button>
      ))}
    </div>
  ),
}));

const SUBMIT: BoundActionSpec = {
  label: 'Create',
  path: 'tasks/mutations:createTask',
  mode: 'mutation',
  args: { title: '$input.title' },
};

const TITLE_FIELD: AutomationConfigField = {
  key: 'title',
  type: 'string',
};

afterEach(() => {
  dispatch.mockClear();
  applyEffect.mockClear();
  isPending = false;
});

describe('Form — rendering and initial values', () => {
  it('prefills fields from initial, resolving $config sentinels', () => {
    render(
      <Form
        fields={[TITLE_FIELD]}
        initial={{ title: '$config:repo' }}
        submit={SUBMIT}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
      'tale-repo',
    );
  });

  it('prefills fields from initial, resolving $projectName', () => {
    render(
      <Form
        fields={[TITLE_FIELD]}
        initial={{ title: '$projectName' }}
        submit={SUBMIT}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
      'SoftInstall Pro Ltd',
    );
  });

  it('seeds fields from initialQuery, overriding the initial default', async () => {
    // The read action returns the file's saved value; it wins over `initial`
    // so the panel reflects what was actually saved (not a stale default).
    dispatch.mockResolvedValueOnce({ method: 'daily_sell' });
    render(
      <Form
        fields={[
          {
            key: 'method',
            type: 'select',
            options: [
              { value: 'estv_monthly', label: 'Monthly' },
              { value: 'daily_sell', label: 'Daily' },
            ],
          },
        ]}
        initial={{ method: 'estv_monthly' }}
        initialQuery={{
          path: 'documents/public_actions:readProjectTextValues',
          args: { folderName: 'Setup' },
        }}
        submit={SUBMIT}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('select')).toHaveAttribute(
        'data-value',
        'daily_sell',
      ),
    );
  });

  it('renders field help as an accessible description', () => {
    render(
      <Form
        fields={[{ ...TITLE_FIELD, help: 'Where the rate comes from' }]}
        submit={SUBMIT}
      />,
    );

    const desc = screen.getByText('Where the rate comes from');
    expect(desc).toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: /Title/ });
    expect(input.getAttribute('aria-describedby')).toContain(
      desc.getAttribute('id'),
    );
  });

  it('renders a textarea for multiline fields and a checkbox for booleans', () => {
    render(
      <Form
        fields={[
          {
            key: 'body',
            type: 'string',
            multiline: true,
          },
          { key: 'urgent', type: 'boolean' },
        ]}
        submit={SUBMIT}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Body' }).tagName).toBe(
      'TEXTAREA',
    );
    expect(
      screen.getByRole('checkbox', { name: 'Urgent' }),
    ).toBeInTheDocument();
  });
});

describe('Form — required validation', () => {
  it('blocks dispatch and wires the inline error accessibly', async () => {
    render(
      <Form fields={[{ ...TITLE_FIELD, required: true }]} submit={SUBMIT} />,
    );

    // Submit is inactive until dirty; touch-then-clear leaves the required
    // field empty AND dirty so the submit path (and its validation) can run.
    const input = screen.getByRole('textbox', { name: /Title/ });
    await userEvent.type(input, 'x');
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(dispatch).not.toHaveBeenCalled();
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('common.validation.required');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(
      error.getAttribute('id'),
    );
  });

  it('clears the error and dispatches once the field is filled', async () => {
    render(
      <Form fields={[{ ...TITLE_FIELD, required: true }]} submit={SUBMIT} />,
    );

    const input = screen.getByRole('textbox', { name: /Title/ });
    await userEvent.type(input, 'x');
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await userEvent.type(input, 'Ship it');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

describe('Form — submit stays inactive until dirty', () => {
  it('disables submit until a field changes, and re-disables after a save', async () => {
    render(
      <Form
        fields={[TITLE_FIELD]}
        submit={SUBMIT}
        onSuccess={{ kind: 'toast', titleKey: 'form.done' }}
      />,
    );

    const button = screen.getByRole('button', { name: 'Create' });
    expect(button).toBeDisabled(); // default/prefilled — no accidental submit

    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'Go');
    expect(button).toBeEnabled();

    await userEvent.click(button);
    expect(dispatch).toHaveBeenCalledTimes(1);
    // a successful save clears the dirty flag → inactive again until next edit
    await waitFor(() => expect(button).toBeDisabled());
  });
});

describe('Form — submit', () => {
  it('dispatches submit.args with the entered values as $input context', async () => {
    render(
      <Form
        fields={[
          TITLE_FIELD,
          { key: 'count', type: 'number' },
          {
            key: 'priority',
            type: 'select',
            options: [{ value: 'low' }, { value: 'high' }],
          },
        ]}
        submit={SUBMIT}
        onSuccess={{ kind: 'toast', titleKey: 'form.done' }}
      />,
    );

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Title' }),
      'Ship it',
    );
    await userEvent.type(
      screen.getByRole('spinbutton', { name: 'Count' }),
      '5',
    );
    await userEvent.click(screen.getByRole('button', { name: 'opt:High' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(dispatch).toHaveBeenCalledWith(SUBMIT.args, undefined, {
      input: { title: 'Ship it', count: 5, priority: 'high' },
    });
    expect(applyEffect).toHaveBeenCalledWith(
      { kind: 'toast', titleKey: 'form.done' },
      { id: 'created1' },
    );
  });

  it('splits derive fields into stored sub-keys before dispatch', async () => {
    render(
      <Form
        fields={[
          {
            key: 'repo',
            type: 'string',
            derive: { pattern: '^([^/]+)/([^/]+)$', into: ['owner', 'name'] },
          },
        ]}
        submit={SUBMIT}
      />,
    );

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Repo' }),
      'tale/platform',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(dispatch).toHaveBeenCalledWith(SUBMIT.args, undefined, {
      input: { repo: 'tale/platform', owner: 'tale', name: 'platform' },
    });
  });

  it('refuses a derive value the rule cannot split', async () => {
    render(
      <Form
        fields={[
          {
            key: 'repo',
            type: 'string',
            derive: { pattern: '^([^/]+)/([^/]+)$', into: ['owner', 'name'] },
          },
        ]}
        submit={SUBMIT}
      />,
    );

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Repo' }),
      'no-slash',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'automations.config.invalidValue',
    );
  });

  it('disables the submit button while the action is pending', () => {
    isPending = true;

    render(<Form fields={[TITLE_FIELD]} submit={SUBMIT} />);

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });
});

describe('Form — blocked path', () => {
  it('shows the blocked notice instead of the form', () => {
    render(
      <Form
        fields={[TITLE_FIELD]}
        submit={{ ...SUBMIT, path: 'tasks/mutations:notAllowed' }}
      />,
    );

    expect(screen.getByText('automations.binding.blocked')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

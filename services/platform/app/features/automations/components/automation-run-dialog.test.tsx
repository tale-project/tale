import { expect, it, vi } from 'vitest';

import { render, screen, waitFor, within } from '@/tests/utils/render';

import { AutomationRunDialog } from './automation-run-dialog';

const schemaFor = (source: 'github' | 'glitchtip') => ({
  type: 'object',
  properties: {
    projectId: { type: 'string', minLength: 1 },
    ...(source === 'github'
      ? {
          owner: { type: 'string', minLength: 1 },
          repo: { type: 'string', minLength: 1 },
          labels: { type: 'string' },
        }
      : {
          organization: { type: 'string', minLength: 1 },
          project: { type: 'string', minLength: 1 },
          query: { type: 'string' },
        }),
    limit: { type: 'integer', minimum: 1, maximum: 500 },
    cursor: { type: 'string' },
  },
  required:
    source === 'github'
      ? ['projectId', 'owner', 'repo']
      : ['projectId', 'organization', 'project'],
  additionalProperties: false,
});

it('keeps a continuation for batch-size edits but resets it when the source changes', async () => {
  const onConfirm = vi.fn();
  const { user } = render(
    <AutomationRunDialog
      request={{
        automationSlug: 'github-import-issues',
        mode: 'mock',
        version: 2,
        schema: schemaFor('github'),
        scopeText: '',
        projectId: 'project-1',
        initialInput: {
          projectId: 'project-1',
          owner: 'example',
          repo: 'app',
          cursor: 'next-page',
        },
      }}
      projects={[
        { _id: 'project-1', name: 'Engineering' },
        { _id: 'project-2', name: 'Other' },
      ]}
      onClose={() => {}}
      onConfirm={onConfirm}
    />,
  );
  await user.clear(screen.getByRole('spinbutton', { name: 'Maximum issues' }));
  await user.type(
    screen.getByRole('spinbutton', { name: 'Maximum issues' }),
    '20',
  );
  await user.click(screen.getByRole('button', { name: 'Test run' }));
  expect(onConfirm).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: 'next-page', limit: 20 }),
    'version',
  );
  await user.type(
    screen.getByRole('textbox', { name: /GitHub repository/ }),
    '-new',
  );
  await user.click(screen.getByRole('button', { name: 'Test run' }));
  expect(onConfirm).toHaveBeenLastCalledWith(
    {
      projectId: 'project-1',
      owner: 'example',
      repo: 'app-new',
      limit: 20,
    },
    'version',
  );
  await user.click(screen.getByRole('button', { name: /Tale project/ }));
  expect(
    screen.queryByRole('option', { name: 'Other' }),
  ).not.toBeInTheDocument();
});

it.each(['github', 'glitchtip'] as const)(
  'imports %s issues with labelled fields and the selected Tale project',
  async (source) => {
    const onConfirm = vi.fn();
    const { user } = render(
      <AutomationRunDialog
        request={{
          automationSlug: `${source}/import-issues`,
          mode: 'mock',
          version: 1,
          scopeText: 'Organization-wide',
          schema: schemaFor(source),
        }}
        projects={[{ _id: 'project-1', name: 'Engineering' }]}
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
    expect(
      screen.queryByRole('textbox', { name: 'Run input (JSON)' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test run' })).toBeDisabled();
    await waitFor(() => {
      expect(
        screen.getByRole('textbox', {
          name:
            source === 'github'
              ? /GitHub owner/
              : /GlitchTip organization slug/,
        }),
      ).toHaveFocus();
    });
    await user.click(screen.getByRole('button', { name: /Tale project/ }));
    await user.click(screen.getByRole('option', { name: 'Engineering' }));
    if (source === 'github') {
      await user.type(
        screen.getByRole('textbox', { name: /GitHub owner/ }),
        'example',
      );
      await user.type(
        screen.getByRole('textbox', { name: /GitHub repository/ }),
        'app',
      );
    } else {
      await user.type(
        screen.getByRole('textbox', { name: /GlitchTip organization slug/ }),
        'example',
      );
      await user.type(
        screen.getByRole('textbox', { name: /GlitchTip project slug/ }),
        'app',
      );
    }
    const limit = screen.getByRole('spinbutton', { name: 'Maximum issues' });
    await user.clear(limit);
    await user.type(limit, '501');
    expect(screen.getByRole('button', { name: 'Test run' })).toBeDisabled();
    await user.clear(limit);
    await user.type(limit, '25');
    await user.click(screen.getByRole('button', { name: 'Test run' }));
    expect(onConfirm).toHaveBeenCalledWith(
      {
        projectId: 'project-1',
        limit: 25,
        ...(source === 'github'
          ? { owner: 'example', repo: 'app' }
          : {
              organization: 'example',
              project: 'app',
              query: 'is:unresolved',
            }),
      },
      'version',
    );
  },
);

it('keeps the generic input editor for an importer with a customized schema', () => {
  const schema = schemaFor('github');
  render(
    <AutomationRunDialog
      request={{
        automationSlug: 'github/import-issues',
        mode: 'mock',
        version: 1,
        scopeText: 'Organization-wide',
        schema: {
          ...schema,
          properties: {
            ...schema.properties,
            customFilter: { type: 'string' },
          },
        },
      }}
      onClose={() => {}}
      onConfirm={() => {}}
    />,
  );
  expect(
    screen.getByRole('textbox', { name: 'Run input (JSON)' }),
  ).toBeVisible();
});

it('shows start failures inside the dialog and retains the entered source', async () => {
  const request = {
    automationSlug: 'github/import-issues',
    mode: 'mock' as const,
    version: 1,
    scopeText: 'Organization-wide',
    schema: schemaFor('github'),
  };
  const { user, rerender } = render(
    <AutomationRunDialog
      request={request}
      onClose={() => {}}
      onConfirm={() => {}}
    />,
  );
  await user.type(
    screen.getByRole('textbox', { name: /GitHub repository/ }),
    'app',
  );
  rerender(
    <AutomationRunDialog
      request={request}
      error="Connect GitHub before importing."
      onClose={() => {}}
      onConfirm={() => {}}
    />,
  );
  expect(
    screen.getByRole('textbox', { name: /GitHub repository/ }),
  ).toHaveValue('app');
  expect(screen.getByText('Connect GitHub before importing.')).toBeVisible();
});

it('identifies invalid JSON as run input and prevents scheduling', async () => {
  let scheduled = false;
  const { user } = render(
    <AutomationRunDialog
      request={{
        mode: 'mock',
        version: 1,
        scopeText: 'Organization-wide',
        schema: { type: 'object' },
      }}
      onClose={() => {}}
      onConfirm={() => {
        scheduled = true;
      }}
    />,
  );
  await user.clear(screen.getByRole('textbox', { name: 'Run input (JSON)' }));
  await user.type(
    screen.getByRole('textbox', { name: 'Run input (JSON)' }),
    'invalid',
  );
  expect(screen.getByText('Enter valid JSON for the run input.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Test run' })).toBeDisabled();
  expect(scheduled).toBe(false);
});

// Cursor is deliberately hidden in the guided form: only a prior run supplies it.
it('keeps a custom required cursor editable through the generic JSON form', () => {
  const schema = schemaFor('github');
  render(
    <AutomationRunDialog
      request={{
        automationSlug: 'github-import-issues',
        mode: 'mock',
        version: 1,
        scopeText: 'Organization-wide',
        schema: { ...schema, required: [...schema.required, 'cursor'] },
      }}
      onClose={() => {}}
      onConfirm={() => {}}
    />,
  );
  expect(
    screen.getByRole('textbox', { name: 'Run input (JSON)' }),
  ).toBeVisible();
});

it('takes the run input in the code editor and starts the run on Mod-Enter', async () => {
  const onConfirm = vi.fn();
  const { user } = render(
    <AutomationRunDialog
      request={{
        mode: 'mock',
        version: 3,
        scopeText: 'Organization-wide',
        schema: {
          type: 'object',
          properties: { owner: { type: 'string' } },
          required: ['owner'],
        },
      }}
      onClose={() => {}}
      onConfirm={onConfirm}
    />,
  );
  const input = screen.getByRole('textbox', { name: 'Run input (JSON)' });
  expect(input).toHaveAttribute('data-language', 'json');
  // Not yet what the schema takes: Mod-Enter starts nothing.
  await user.click(input);
  await user.keyboard('{Control>}{Enter}{/Control}');
  expect(onConfirm).not.toHaveBeenCalled();
  await user.clear(input);
  await user.type(input, '{{"owner": "acme"}');
  await user.keyboard('{Control>}{Enter}{/Control}');
  expect(onConfirm).toHaveBeenCalledWith({ owner: 'acme' }, 'version');
});

it('shows the input schema as a tree of its fields', async () => {
  const { user } = render(
    <AutomationRunDialog
      request={{
        mode: 'mock',
        version: 3,
        scopeText: 'Organization-wide',
        schema: {
          type: 'object',
          properties: { owner: { type: 'string' } },
          required: ['owner'],
        },
      }}
      onClose={() => {}}
      onConfirm={() => {}}
    />,
  );
  await user.click(screen.getByText('Input schema'));
  const tree = screen.getByRole('list', { name: 'Input schema' });
  expect(tree).toHaveTextContent('owner');
  expect(tree).toHaveTextContent('required');
});

it('asks whether the draft or the saved version runs, and checks each against its own input', async () => {
  const onConfirm = vi.fn();
  const quantity = { type: 'integer' };
  const { user } = render(
    <AutomationRunDialog
      request={{
        mode: 'mock',
        version: 3,
        schema: {
          type: 'object',
          properties: { quantity },
          required: ['quantity'],
        },
        draft: {
          schema: {
            type: 'object',
            properties: { quantity, unitPrice: { type: 'number' } },
            required: ['quantity', 'unitPrice'],
          },
        },
        initialInput: { quantity: 5 },
        scopeText: 'This run operates organization-wide, across every project.',
      }}
      onClose={() => {}}
      onConfirm={onConfirm}
    />,
  );
  const group = screen.getByRole('radiogroup', { name: 'What runs' });
  expect(
    within(group).getByRole('radio', { name: /This draft \(not saved\)/ }),
  ).toBeChecked();
  // A try keeps no run, so it has no project scope to explain; and the
  // draft asks for a unit price the version does not.
  expect(screen.queryByText(/organization-wide/)).not.toBeInTheDocument();
  expect(
    screen.getByText(/does not match the schema.*unitPrice/),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Test run' })).toBeDisabled();

  await user.click(within(group).getByRole('radio', { name: /Version 3/ }));
  expect(screen.getByText(/organization-wide/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Test run' }));
  expect(onConfirm).toHaveBeenLastCalledWith({ quantity: 5 }, 'version');
});

it('tries the draft with the input it takes', async () => {
  const onConfirm = vi.fn();
  const { user } = render(
    <AutomationRunDialog
      request={{
        mode: 'mock',
        version: 3,
        draft: {},
        scopeText: '',
      }}
      onClose={() => {}}
      onConfirm={onConfirm}
    />,
  );
  // The draft declares no input: there is nothing to type, only to run.
  expect(
    screen.queryByRole('textbox', { name: /Run input/ }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Test run' }));
  expect(onConfirm).toHaveBeenLastCalledWith({}, 'draft');
});

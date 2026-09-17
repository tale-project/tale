import { expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { AutomationRunDialog } from './automation-run-dialog';

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

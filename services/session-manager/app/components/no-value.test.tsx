import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

import { NoValue } from './no-value';

/** A table cell: where a person meets the value, and where a screen reader names it. */
function renderInCell(label: string) {
  return renderApp(
    <table>
      <tbody>
        <tr>
          <td>
            <NoValue label={label} />
          </td>
        </tr>
      </tbody>
    </table>,
  );
}

describe('NoValue', () => {
  it('is a dash to the eye and the word it is given to a screen reader', () => {
    renderInCell('No details');
    // The dash is for the eye alone; what is heard is the word.
    expect(screen.getByRole('cell')).toHaveTextContent('—');
    expect(screen.getByRole('cell', { name: 'No details' })).toBeVisible();
  });

  it('has no accessibility violations', async () => {
    const view = renderInCell('Unknown');
    await checkAccessibility(view);
  });
});

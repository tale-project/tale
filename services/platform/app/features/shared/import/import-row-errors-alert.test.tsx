// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// Params are appended (`key row=3 message=…`) so the translated reason and
// the label it takes are assertable through the key.
vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params
        ? `${ns}.${key} ${Object.entries(params)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(' ')}`
        : `${ns}.${key}`,
  }),
}));

import { ImportRowErrorsAlert } from './import-row-errors-alert';

describe('ImportRowErrorsAlert', () => {
  it('translates a parser refusal and keeps a server refusal verbatim', () => {
    render(
      <ImportRowErrorsAlert
        errors={[
          { row: 3, field: 'email', reason: 'blank' },
          { row: 4, message: 'locale: is not a locale' },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([
      'common.import.rowError row=3 message=common.import.reasons.blank field=common.import.fields.email',
      'common.import.rowError row=4 message=locale: is not a locale',
    ]);
  });

  it('renders nothing without errors', () => {
    const { container } = render(<ImportRowErrorsAlert errors={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

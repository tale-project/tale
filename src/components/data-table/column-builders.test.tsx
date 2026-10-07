import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { i18n, initI18n } from '../../i18n/init';
import { uiMessages } from '../../i18n/messages';
import { createLocaleColumn } from './column-builders';

initI18n({
  bundles: { en: {}, ...uiMessages.bundles },
  global: uiMessages.global,
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

it('names the language column in German with only the shipped UI catalogs', async () => {
  await i18n.changeLanguage('de');
  function LanguageTable() {
    const table = useReactTable({
      data: [],
      columns: [createLocaleColumn()],
      getCoreRowModel: getCoreRowModel(),
    });
    return (
      <table>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id}>
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
      </table>
    );
  }
  render(<LanguageTable />);
  const cell = screen.getByRole('columnheader', { name: 'Sprache' });
  expect(cell).toHaveAccessibleName('Sprache');
  expect(within(cell).queryByLabelText('Locale')).not.toBeInTheDocument();
  expect(cell.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
});

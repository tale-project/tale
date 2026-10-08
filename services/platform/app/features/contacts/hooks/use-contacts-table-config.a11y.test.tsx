import { DataTable } from '@tale/ui/data-table/data-table';
import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { afterEach, expect, it, vi } from 'vitest';

import { i18n } from '@/tests/utils/i18n-all-languages';
import { render, screen } from '@/tests/utils/render';

import { useContactsTableConfig } from './use-contacts-table-config';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => false, cannot: () => true }),
}));
vi.mock('../components/contact-row-actions', () => ({
  ContactRowActions: () => null,
}));

afterEach(async () => {
  localStorage.removeItem(LOCALE_STORAGE_KEY);
  await i18n.changeLanguage('en');
});

it('gives the contacts language column its translated German accessible name', async () => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
  await i18n.changeLanguage('de');
  function ContactsColumns() {
    const { columns } = useContactsTableConfig();
    return <DataTable columns={columns} data={[]} isLoading />;
  }
  render(<ContactsColumns />);
  expect(
    screen.getByRole('columnheader', { name: 'Sprache' }),
  ).toHaveAccessibleName('Sprache');
});

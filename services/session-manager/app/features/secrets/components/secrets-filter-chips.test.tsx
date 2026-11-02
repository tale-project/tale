import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { screen, waitFor, within } from '@testing-library/react';
import { KeyRound } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

import {
  SecretsFilterChips,
  type SecretsFilterChip,
} from './secrets-filter-chips';

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});

function chip(overrides: Partial<SecretsFilterChip> = {}): SecretsFilterChip {
  return {
    key: 'type',
    icon: KeyRound,
    filter: 'Type',
    value: 'Credentials',
    onRemove: vi.fn(),
    ...overrides,
  };
}

describe('SecretsFilterChips', () => {
  it('shows nothing when no filter narrows the list', () => {
    const { container } = renderApp(<SecretsFilterChips chips={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names each filter in force by what it filters and by what, as a group of active filters', () => {
    renderApp(
      <SecretsFilterChips
        chips={[
          chip(),
          chip({
            key: 'scope',
            icon: undefined,
            filter: 'Available to',
            value: 'Session 0003',
          }),
        ]}
      />,
    );

    const list = screen.getByRole('list', { name: 'Active filters' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Type: Credentials', 'Available to: Session 0003']);
  });

  it('removes a filter with a button that says so, named by the filter it removes', async () => {
    const onRemove = vi.fn();
    const { user } = renderApp(
      <SecretsFilterChips chips={[chip({ onRemove })]} />,
    );

    const button = screen.getByRole('button', {
      name: 'Remove filter Type: Credentials',
    });
    // The visible words are in the name, so a voice command can say them.
    expect(button).toHaveTextContent('Type: Credentials');
    await user.click(button);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('removes a filter from the keyboard', async () => {
    const onRemove = vi.fn();
    const { user } = renderApp(
      <SecretsFilterChips chips={[chip({ onRemove })]} />,
    );

    await user.tab();
    expect(
      screen.getByRole('button', { name: /^Remove filter/ }),
    ).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onRemove).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(onRemove).toHaveBeenCalledTimes(2);
  });

  it('reaches the chips one after the other with Tab', async () => {
    const { user } = renderApp(
      <SecretsFilterChips
        chips={[
          chip(),
          chip({
            key: 'scope',
            filter: 'Available to',
            value: 'Every session',
          }),
        ]}
      />,
    );
    await user.tab();
    expect(screen.getAllByRole('button')[0]).toHaveFocus();
    await user.tab();
    expect(screen.getAllByRole('button')[1]).toHaveFocus();
  });

  it('cuts a very long name short, and keeps the whole of it where it is read on hover', () => {
    const long = 'S'.repeat(120);
    renderApp(
      <SecretsFilterChips
        chips={[chip({ filter: 'Available to', value: `Session ${long}` })]}
      />,
    );
    const button = screen.getByRole('button', { name: /^Remove filter/ });
    expect(button).toHaveAttribute('title', `Available to: Session ${long}`);
  });

  it('has no accessibility violations', async () => {
    const view = renderApp(
      <SecretsFilterChips
        chips={[
          chip(),
          chip({
            key: 'scope',
            filter: 'Available to',
            value: 'Every session',
          }),
        ]}
      />,
    );
    await checkAccessibility(view);
  });

  it('speaks German', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    renderApp(
      <SecretsFilterChips
        chips={[chip({ filter: 'Typ', value: 'Kreditkarte' })]}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole('list', { name: 'Aktive Filter' }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: 'Filter Typ: Kreditkarte entfernen' }),
    ).toBeInTheDocument();
  });

  it('speaks French', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    renderApp(
      <SecretsFilterChips
        chips={[chip({ filter: 'Type', value: 'Carte bancaire' })]}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole('list', { name: 'Filtres actifs' }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', {
        name: 'Retirer le filtre Type\u00a0: Carte bancaire',
      }),
    ).toBeInTheDocument();
  });
});

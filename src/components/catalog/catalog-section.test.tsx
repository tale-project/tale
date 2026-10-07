// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import {
  CatalogSection,
  folderLabel,
  groupCatalogItems,
} from './catalog-section';

// i18next echo stub: returns the key's `defaultValue` (the behaviour for a
// missing key), except for the known general key where it returns a marker so
// the test can tell a real lookup from the fallback.
const t = ((key: string, opts?: { defaultValue?: string }) =>
  key === 'folders.general'
    ? 'General (localized)'
    : (opts?.defaultValue ?? key)) as unknown as TFunction;

describe('CatalogSection', () => {
  it('renders the title as a real h3 over the section content', () => {
    render(
      <CatalogSection title="Sales">
        <div>card</div>
      </CatalogSection>,
    );
    expect(
      screen.getByRole('heading', { name: 'Sales', level: 3 }),
    ).toBeInTheDocument();
    expect(screen.getByText('card')).toBeInTheDocument();
  });
});

describe('groupCatalogItems', () => {
  it('groups by folder and sorts folders alphabetically', () => {
    const items = [
      { name: 'c1', folder: 'chat' },
      { name: 'g1', folder: 'github' },
      { name: 'c2', folder: 'chat' },
    ];
    expect(groupCatalogItems(items, (i) => i.folder)).toStrictEqual([
      [
        'chat',
        [
          { name: 'c1', folder: 'chat' },
          { name: 'c2', folder: 'chat' },
        ],
      ],
      ['github', [{ name: 'g1', folder: 'github' }]],
    ]);
  });

  it('always sorts the ungrouped bucket last', () => {
    const items = [
      { name: 'loose', folder: '' },
      { name: 'z', folder: 'zeta' },
      { name: 'a', folder: 'alpha' },
    ];
    expect(
      groupCatalogItems(items, (i) => i.folder).map(([folder]) => folder),
    ).toStrictEqual(['alpha', 'zeta', '']);
  });

  it('preserves item order inside each group', () => {
    const items = [
      { name: 'second', folder: 'x' },
      { name: 'first', folder: 'x' },
    ];
    const [[, grouped]] = groupCatalogItems(items, (i) => i.folder);
    expect(grouped.map((i) => i.name)).toStrictEqual(['second', 'first']);
  });
});

describe('folderLabel', () => {
  it('resolves the ungrouped bucket through the folders.general key', () => {
    expect(folderLabel(t, '')).toBe('General (localized)');
  });

  it('falls back to a capitalized raw folder when no key exists', () => {
    expect(folderLabel(t, 'sales')).toBe('Sales');
  });
});

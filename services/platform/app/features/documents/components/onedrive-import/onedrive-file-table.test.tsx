import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { cleanup, render, screen } from '@/tests/utils/render';

import { OneDriveFileTable } from './onedrive-file-table';
import type { OneDriveApiItem } from './types';

const ITEMS: OneDriveApiItem[] = [
  { id: 'folder-1', name: 'Meetings', size: 0, isFolder: true },
  { id: 'file-1', name: 'notes.docx', size: 10, isFolder: false },
];

/** What a screen reader reads for each box, as every shipped catalog words
 * it (`common.aria.selectAll`, `documents.aria.selectItem`). */
const NAMES = {
  en: {
    all: 'Select all',
    folder: 'Select Meetings',
    file: 'Select notes.docx',
  },
  de: {
    all: 'Alle auswählen',
    folder: 'Meetings auswählen',
    file: 'notes.docx auswählen',
  },
  fr: {
    all: 'Tout sélectionner',
    folder: 'Sélectionner Meetings',
    file: 'Sélectionner notes.docx',
  },
} as const;

// Unmount first: the app shell still applying the saved language would
// otherwise switch it back after the reset.
afterEach(async () => {
  cleanup();
  await forgetSavedLocale();
});

function renderTable() {
  const props = {
    items: ITEMS,
    isLoading: false,
    searchQuery: '',
    selectedItems: new Map(),
    getSelectAllState: () => false,
    handleSelectAllChange: vi.fn(),
    getCheckedState: () => false,
    handleCheckChange: vi.fn(),
    handleFolderClick: vi.fn(),
    buildItemPath: (item: OneDriveApiItem) => item.name,
  };
  return { props, ...render(<OneDriveFileTable {...props} />) };
}

// The table every cloud picker shows (Google Drive, OneDrive and a SharePoint
// library) rendered its checkboxes unnamed, so a screen reader announced
// each row's box as a bare "checkbox" (WCAG 4.1.2).
describe.each(SHIPPED_LOCALES)('the cloud file table (%s)', (locale) => {
  it('names the select-all box, and every row box after its item', async () => {
    saveLocale(locale);
    await i18n.changeLanguage(locale);
    const { container, props, user } = renderTable();
    const names = NAMES[locale];

    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toHaveAccessibleName();
    }
    await user.click(screen.getByRole('checkbox', { name: names.file }));
    expect(props.handleCheckChange).toHaveBeenLastCalledWith('file-1', true);
    await user.click(screen.getByRole('checkbox', { name: names.folder }));
    expect(props.handleCheckChange).toHaveBeenLastCalledWith('folder-1', true);
    await user.click(screen.getByRole('checkbox', { name: names.all }));
    expect(props.handleSelectAllChange).toHaveBeenCalledWith(true);
    await checkAccessibility(container);
  });
});

import '@testing-library/jest-dom/vitest';
import { Dialog } from '@tale/ui/dialog/dialog';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { deriveAccentPalette } from '@/lib/utils/color';
import { inkContrast } from '@/tests/utils/paint';
import { cleanup, render, screen } from '@/tests/utils/render';

import { OneDriveFileTable } from './onedrive-import/onedrive-file-table';
import { SharePointDrivesTable } from './onedrive-import/sharepoint-drives-table';
import { SharePointSitesTable } from './onedrive-import/sharepoint-sites-table';

import '@/app/globals.css';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('style');
});

describe.each(['#AE005E', '#FF00FF', '#0B0B2A', '#F5F5F0'])(
  'cloud picker text with accent %s',
  (accent) => {
    it.each(['light', 'dark'] as const)(
      'reads on the real dialog and hovered table row in %s mode',
      async (theme) => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        document.documentElement.style.setProperty(
          '--primary',
          deriveAccentPalette(accent, theme).textHsl,
        );
        render(
          <Dialog open onOpenChange={() => {}} title="Cloud files">
            {/* Judge the settled colors, independent of transition timing. */}
            <style>{'* { transition: none !important; }'}</style>
            <OneDriveFileTable
              items={[
                { id: 'folder', name: 'Folder', size: 0, isFolder: true },
              ]}
              isLoading={false}
              searchQuery=""
              selectedItems={new Map()}
              getSelectAllState={() => false}
              handleSelectAllChange={() => {}}
              getCheckedState={() => false}
              handleCheckChange={() => {}}
              handleFolderClick={() => {}}
              buildItemPath={(item) => item.name}
            />
            <SharePointSitesTable
              sites={[
                {
                  id: 'site',
                  name: 'site',
                  displayName: 'Example site',
                  webUrl: 'https://example.com/sites/example',
                },
              ]}
              isLoading={false}
              onSiteClick={() => {}}
            />
            <SharePointDrivesTable
              drives={[
                {
                  id: 'drive',
                  name: 'Example drive',
                  driveType: 'documentLibrary',
                },
              ]}
              isLoading={false}
              onDriveClick={() => {}}
            />
          </Dialog>,
        );

        // The dialog is bg-card, while a hovered row adds bg-muted/50.
        // #AE005E's page-safe dark text shade fails on that composition.
        for (const label of ['Folder', 'Example site', 'Example drive']) {
          const text = screen.getByText(label, { exact: true });
          expect
            .soft(inkContrast(text), `${label} at rest`)
            .toBeGreaterThanOrEqual(4.5);
          await userEvent.hover(text);
          expect
            .soft(inkContrast(text), `${label} on row hover`)
            .toBeGreaterThanOrEqual(4.5);
        }
      },
    );
  },
);

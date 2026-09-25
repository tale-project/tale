import '@testing-library/jest-dom/vitest';
import { cleanup, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { DataTableActionMenu } from '../data-table/data-table-action-menu';
import { Dialog } from './dialog';

import '../../globals.css';

afterEach(cleanup);

function MenuDialogHarness() {
  const [dialog, setDialog] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      {preview ? (
        <button type="button" onClick={() => setPreview(false)}>
          Close preview
        </button>
      ) : (
        <DataTableActionMenu
          triggerRef={triggerRef}
          label="Actions"
          menuItems={['Share', 'Microsoft', 'Google'].map((label) => ({
            label,
            onClick: () => setDialog(label),
          }))}
        />
      )}
      {dialog && (
        <Dialog
          open
          restoreFocusRef={triggerRef}
          title={dialog}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        >
          <button
            type="button"
            onClick={() => {
              setDialog(null);
              setPreview(true);
            }}
          >
            Preview
          </button>
        </Dialog>
      )}
    </>
  );
}

describe('menu-to-dialog lifecycle', () => {
  it('keeps keyboard activation, modal focus trapping and trigger restoration', async () => {
    const { user } = render(<MenuDialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Share' })).toHaveFocus();
    });
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Share' });
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    for (let index = 0; index < 5; index++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('menu', { hidden: true }),
      ).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  it('releases pointer blocking after preview navigation and successive pickers', async () => {
    render(<MenuDialogHarness />);
    for (let round = 0; round < 3; round++) {
      await page.getByRole('button', { name: 'Actions' }).click();
      await page.getByRole('menuitem', { name: 'Share' }).click();
      await page.getByRole('button', { name: 'Preview' }).click();
      await waitFor(() => {
        expect(document.body.style.pointerEvents).not.toBe('none');
        expect(
          screen.queryByRole('menu', { hidden: true }),
        ).not.toBeInTheDocument();
      });
      await page.getByRole('button', { name: 'Close preview' }).click();
      for (const name of ['Microsoft', 'Google']) {
        await page.getByRole('button', { name: 'Actions' }).click();
        await page.getByRole('menuitem', { name }).click();
        expect(screen.getByRole('dialog', { name })).toBeInTheDocument();
        await userEvent.keyboard('{Escape}');
        await waitFor(() => {
          expect(document.body.style.pointerEvents).not.toBe('none');
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
          expect(
            screen.queryByRole('menu', { hidden: true }),
          ).not.toBeInTheDocument();
        });
      }
    }
  });
});

import '@testing-library/jest-dom/vitest';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { Textarea } from '@tale/ui/textarea';
import { cleanup, waitFor } from '@testing-library/react';
import { Globe } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { EntityViewDialog } from './entity-view-dialog';

import '../../globals.css';

afterEach(cleanup);

function renderRecord(name = 'example.com') {
  return render(
    <EntityViewDialog
      open
      onOpenChange={() => undefined}
      title="Website details"
      name={name}
      icon={Globe}
      facts={[
        { label: 'Scan interval', value: 'Every 6 hours' },
        { label: 'Last scanned', value: 'September 22, 2026 9:30 AM' },
      ]}
      identifier={{
        label: 'Website ID',
        value: '795c9221-156f-434e-a458-24625f59bde0',
      }}
    />,
  );
}

describe('record details layout', () => {
  it('fits a short record without the form minimum height or wrapped date', async () => {
    await page.viewport(1100, 900);
    renderRecord();
    const dialog = screen.getByRole('dialog');
    await waitFor(() => {
      expect(dialog.getBoundingClientRect().width).toBe(512);
      expect(dialog.getBoundingClientRect().height).toBeLessThan(400);
    });
    const date = screen.getByText('September 22, 2026 9:30 AM');
    expect(date.getBoundingClientRect().height).toBeLessThan(30);
  });

  it('sizes record forms to their fields and keeps the footer directly below them', async () => {
    await page.viewport(1100, 900);
    render(
      <FormDialog
        open
        title="Edit knowledge entry"
        size="entity"
        onOpenChange={() => undefined}
        onSubmit={() => undefined}
      >
        <Input label="Topic" defaultValue="Returns policy" />
        <Textarea
          label="Content"
          rows={4}
          defaultValue="Customers can return unused items within 30 days."
        />
      </FormDialog>,
    );
    const dialog = screen.getByRole('dialog');
    await waitFor(() =>
      expect(dialog.getBoundingClientRect().height).toBeLessThan(440),
    );
    const field = screen.getByRole('textbox', { name: 'Content' });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(
      save.getBoundingClientRect().top - field.getBoundingClientRect().bottom,
    ).toBeLessThan(40);
  });

  it('keeps long names and identifiers within a phone viewport', async () => {
    await page.viewport(375, 667);
    renderRecord(
      'a-very-long-unbroken-record-name-that-must-wrap-without-horizontal-scrolling',
    );
    const dialog = screen.getByRole('dialog');
    await waitFor(() => {
      const box = dialog.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(375);
      expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
      expect(box.height).toBeLessThanOrEqual(667 * 0.9 + 1);
    });
    expect(
      screen.getByRole('button', {
        name: '795c9221-156f-434e-a458-24625f59bde0',
      }),
    ).toBeVisible();
  });
});

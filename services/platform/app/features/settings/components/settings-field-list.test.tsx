import { FIELD_ROW_CONTROL } from '@tale/ui/field-shell';
import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { SettingsFieldList, SettingsFieldRow } from './settings-field-list';

describe('SettingsFieldRow', () => {
  it('marks itself as a settings field row', () => {
    render(
      <SettingsFieldList>
        <SettingsFieldRow label="Name">
          <input aria-label="Name" />
        </SettingsFieldRow>
      </SettingsFieldList>,
    );
    const row = screen
      .getByRole('textbox', { name: 'Name' })
      .closest('[data-settings-field-row]');
    expect(row).not.toBeNull();
  });

  // The row's wrapper is a plain div, so its label and help reach a screen
  // reader only through the control — which points at them by the row's ids.
  it('names and describes a control rendered as a function of its ids', () => {
    render(
      <SettingsFieldList>
        <SettingsFieldRow label="Audience" description="Empty means everyone.">
          {({ labelId, descriptionId }) => (
            <input aria-labelledby={labelId} aria-describedby={descriptionId} />
          )}
        </SettingsFieldRow>
      </SettingsFieldList>,
    );
    const control = screen.getByRole('textbox', { name: 'Audience' });
    expect(control).toHaveAccessibleDescription('Empty means everyone.');
    // Still pinned to the shared control column.
    expect(control.parentElement?.className).toContain(FIELD_ROW_CONTROL);
  });
});

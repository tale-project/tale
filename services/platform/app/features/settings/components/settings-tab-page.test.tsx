import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { SettingsSection } from './settings-section';
import { SettingsTabPage } from './settings-tab-page';

// #2794: a tab that is a settings form — a project's General and Environment,
// an automation's General — stands in the general settings page the way
// Settings composes it: the page inside the tab's padded content area, named
// like the open tab.
describe('SettingsTabPage', () => {
  it('stands the settings page in the tab’s content area', () => {
    const { container } = render(
      <SettingsTabPage title="General">
        <SettingsSection title="Trigger">
          <p>Schedule</p>
        </SettingsSection>
      </SettingsTabPage>,
    );

    const frame = container.firstElementChild;
    const page = screen.getByRole('region', { name: 'Trigger' }).parentElement;
    expect(frame).toHaveClass('px-4', 'pt-4');
    expect(frame).not.toHaveAttribute('data-field-layout');
    expect(page?.parentElement).toBe(frame);
    expect(page).toHaveAttribute('data-field-layout', 'row');
    expect(page).toHaveClass('mx-auto', 'max-w-3xl', 'gap-8');
  });

  // The tab strip names the page the way the settings header does, so a
  // first section titled like the tab keeps its heading for assistive tech
  // only, while a section titled otherwise keeps it in print.
  it('marks a first section titled like the tab as repeating the page title', () => {
    render(
      <SettingsTabPage title="Environment">
        <SettingsSection title="Environment" description="Variables.">
          <p>Rows</p>
        </SettingsSection>
        <SettingsSection title="Access">
          <p>Notice</p>
        </SettingsSection>
      </SettingsTabPage>,
    );

    expect(screen.getByRole('region', { name: 'Environment' })).toHaveAttribute(
      'data-repeats-page-title',
    );
    expect(screen.getByRole('region', { name: 'Access' })).not.toHaveAttribute(
      'data-repeats-page-title',
    );
  });
});

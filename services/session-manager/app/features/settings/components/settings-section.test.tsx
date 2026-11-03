import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';

import { SECTION_DIVIDER_CLASS, SettingsSection } from './settings-section';

describe('SettingsSection', () => {
  it('is a landmark named by its title, which is a heading of the second level', () => {
    renderApp(
      <SettingsSection title="This device">
        <p>Content</p>
      </SettingsSection>,
    );

    const section = screen.getByRole('region', { name: 'This device' });
    expect(
      within(section).getByRole('heading', { level: 2, name: 'This device' }),
    ).toBeInTheDocument();
    expect(within(section).getByText('Content')).toBeInTheDocument();
  });

  it('is described by its description, which stays readable text', () => {
    renderApp(
      <SettingsSection title="Sessions" description="Where a new one starts.">
        <p>Content</p>
      </SettingsSection>,
    );
    const section = screen.getByRole('region', { name: 'Sessions' });
    expect(section).toHaveAccessibleDescription('Where a new one starts.');
  });

  it('needs no description', () => {
    renderApp(<SettingsSection title="About" />);
    expect(screen.getByRole('region', { name: 'About' })).not.toHaveAttribute(
      'aria-describedby',
    );
  });

  it('carries an action beside its title', () => {
    renderApp(
      <SettingsSection
        title="About"
        action={<button type="button">Check</button>}
      />,
    );
    const section = screen.getByRole('region', { name: 'About' });
    expect(
      within(section).getByRole('button', { name: 'Check' }),
    ).toBeInTheDocument();
  });

  it('marks itself as a section of a settings page, which is what the dividers go by', () => {
    renderApp(<SettingsSection title="About" />);
    expect(screen.getByRole('region', { name: 'About' })).toHaveAttribute(
      'data-settings-section',
    );
  });

  it('has no accessibility violations', async () => {
    const view = renderApp(
      <SettingsSection title="About" description="What this is.">
        <p>Content</p>
      </SettingsSection>,
    );
    await checkAccessibility(view);
  });
});

describe('SECTION_DIVIDER_CLASS', () => {
  it('draws the rule between sections by their marker, not by the tag: a section in a wrapper keeps its line', () => {
    expect(SECTION_DIVIDER_CLASS).toContain('[data-settings-section]');
    expect(SECTION_DIVIDER_CLASS).toContain(':has([data-settings-section])');
    expect(SECTION_DIVIDER_CLASS).not.toContain('>section~section');
  });
});

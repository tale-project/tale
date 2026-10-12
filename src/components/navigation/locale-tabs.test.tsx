import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { LocaleTabs } from './locale-tabs';

const textPanel = (locale: string) => (
  <textarea aria-label={`Text ${locale}`} />
);

function Harness({
  translated = [],
  onAutoTranslate,
}: {
  translated?: string[];
  onAutoTranslate?: () => void;
}) {
  const [editingLocale, setEditingLocale] = useState('en');
  return (
    <LocaleTabs
      defaultLocale="en"
      editingLocale={editingLocale}
      onEditingLocaleChange={setEditingLocale}
      hasTranslation={(locale) => translated.includes(locale)}
      listAriaLabel="Notice languages"
      renderPanel={textPanel}
      {...(onAutoTranslate ? { onAutoTranslate } : {})}
    />
  );
}

describe('LocaleTabs', () => {
  it('offers one tab per supported locale, the default first, named in its own language', () => {
    render(<Harness translated={['de']} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'English(default)',
      'Deutsch',
      'Françaisuntranslated',
    ]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('follows the caller-supplied locales and order', () => {
    render(
      <LocaleTabs
        defaultLocale="de"
        locales={['en', 'de']}
        editingLocale="de"
        onEditingLocaleChange={() => {}}
        hasTranslation={() => true}
        renderPanel={textPanel}
      />,
    );

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Deutsch(default)',
      'English',
    ]);
  });

  it('never asks whether the default locale is translated', () => {
    const hasTranslation = vi.fn(() => false);
    render(
      <LocaleTabs
        defaultLocale="en"
        editingLocale="en"
        onEditingLocaleChange={() => {}}
        hasTranslation={hasTranslation}
        renderPanel={textPanel}
      />,
    );

    expect(hasTranslation).not.toHaveBeenCalledWith('en');
  });

  it('offers auto-translate only on a translation tab', async () => {
    const onAutoTranslate = vi.fn();
    const { user } = render(<Harness onAutoTranslate={onAutoTranslate} />);

    expect(
      screen.queryByRole('button', { name: 'Auto-translate' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Deutsch/ }));
    await user.click(screen.getByRole('button', { name: 'Auto-translate' }));

    expect(onAutoTranslate).toHaveBeenCalledOnce();
  });

  it('renders each locale in its own tab panel and keeps hidden panels mounted', async () => {
    const { user } = render(<Harness />);
    // Every panel stays mounted; the active one carries data-state="active"
    // (inactive ones are hidden by a data-state class this jsdom run lacks).
    const activePanel = () =>
      document.querySelector('[role="tabpanel"][data-state="active"]');

    expect(screen.getAllByRole('tabpanel')).toHaveLength(3);
    expect(activePanel()).toContainElement(screen.getByLabelText('Text en'));

    await user.click(screen.getByRole('tab', { name: /Français/ }));

    expect(activePanel()).toContainElement(screen.getByLabelText('Text fr'));
    expect(screen.getByLabelText('Text en')).toBeInTheDocument();
  });

  it('marks a locale whose editor holds an error, in its accessible name too', () => {
    render(
      <LocaleTabs
        defaultLocale="en"
        editingLocale="en"
        onEditingLocaleChange={() => {}}
        hasTranslation={() => true}
        hasError={(locale) => locale === 'fr'}
        renderPanel={textPanel}
      />,
    );

    expect(
      screen.getByRole('tab', { name: /Français.*has an error/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Deutsch/ })).not.toHaveTextContent(
      'has an error',
    );
  });

  it('passes an axe audit', async () => {
    const { container } = render(<Harness translated={['de']} />);
    await checkAccessibility(container);
  });
});

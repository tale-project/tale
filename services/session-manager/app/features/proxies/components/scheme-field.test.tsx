import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderApp } from '@/tests/utils/render';

import { SchemeField } from './scheme-field';

afterEach(resetLanguage);

describe('SchemeField', () => {
  it('offers the three types, with the chosen one marked', () => {
    renderApp(<SchemeField value="https" onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'HTTP' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'HTTPS' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'SOCKS5' })).not.toBeChecked();
    expect(
      screen.getByText("Used when a proxy doesn't specify its own type."),
    ).toBeVisible();
  });

  it('is named for what it chooses, which "Type" alone does not say next to a list of lines', () => {
    renderApp(<SchemeField value="http" onChange={vi.fn()} />);

    expect(screen.getByRole('radiogroup')).toHaveAccessibleName('Proxy type');
  });

  it('says which type another is chosen', async () => {
    const onChange = vi.fn();
    const { user } = renderApp(
      <SchemeField value="http" onChange={onChange} />,
    );

    await user.click(screen.getByRole('radio', { name: 'SOCKS5' }));

    expect(onChange).toHaveBeenCalledWith('socks5');
  });

  it('moves along the types with the arrow keys', async () => {
    const onChange = vi.fn();
    const { user } = renderApp(
      <SchemeField value="http" onChange={onChange} />,
    );

    screen.getByRole('radio', { name: 'HTTP' }).focus();
    await user.keyboard('{ArrowRight}');

    expect(onChange).toHaveBeenCalledWith('https');
  });

  it('keeps the chosen type when it is chosen again', async () => {
    const onChange = vi.fn();
    const { user } = renderApp(
      <SchemeField value="http" onChange={onChange} />,
    );

    await user.click(screen.getByRole('radio', { name: 'HTTP' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('cannot be changed while disabled', async () => {
    const onChange = vi.fn();
    const { user } = renderApp(
      <SchemeField value="http" onChange={onChange} disabled />,
    );

    await user.click(screen.getByRole('radio', { name: 'HTTPS' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('speaks German', async () => {
    await showLanguage('de');
    renderApp(<SchemeField value="http" onChange={vi.fn()} />);

    expect(screen.getByRole('radiogroup')).toHaveAccessibleName('Proxy-Typ');
    expect(
      screen.getByText('Gilt, wenn ein Proxy seinen Typ nicht selbst angibt.'),
    ).toBeVisible();
  });

  it('has no accessibility violations', async () => {
    const view = renderApp(<SchemeField value="http" onChange={vi.fn()} />);
    await checkAccessibility(view);
  });
});

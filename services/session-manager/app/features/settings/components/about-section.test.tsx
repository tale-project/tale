import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { meta } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

import { AboutSection } from './about-section';

/** The value shown next to a name of the list. */
const valueOf = (name: string) => screen.getByText(name).nextElementSibling;

describe('AboutSection', () => {
  it('shows the app version, the browser build and that the browser is installed', async () => {
    installFakeApi({ 'GET /meta': meta({ version: '0.3.1' }) });
    renderApp(<AboutSection />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'About' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(valueOf('Version')).toHaveTextContent('0.3.1'));
    expect(valueOf('Browser')).toHaveTextContent('Camoufox 152.0.4-beta.30');
    expect(valueOf('Browser installed')).toHaveTextContent('Yes');
  });

  it('reads as pairs of a name and a value', async () => {
    installFakeApi({ 'GET /meta': meta() });
    renderApp(<AboutSection />);
    await screen.findByText('Camoufox 152.0.4-beta.30');

    const names = screen.getAllByRole('term').map((term) => term.textContent);
    expect(names).toEqual(['Version', 'Browser', 'Browser installed']);
    expect(screen.getAllByRole('definition')).toHaveLength(3);
  });

  it('masks the values in place while they load', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    installFakeApi({
      'GET /meta': async () => {
        await gate;
        return meta();
      },
    });
    renderApp(<AboutSection />);

    await screen.findByRole('status', { name: 'Loading content' });
    // The names are there; the values are masks, hidden from a screen reader.
    expect(screen.getByText('Version')).toBeInTheDocument();
    const value = valueOf('Version')?.firstElementChild;
    expect(value).toHaveAttribute('aria-hidden', 'true');

    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() =>
      expect(valueOf('Browser installed')).toHaveTextContent('Yes'),
    );
    expect(
      screen.queryByRole('status', { name: 'Loading content' }),
    ).toBeNull();
  });

  it('says the browser is being installed', async () => {
    installFakeApi({
      'GET /meta': meta({ browserInstalled: false, browserInstalling: true }),
    });
    renderApp(<AboutSection />);
    await waitFor(() =>
      expect(valueOf('Browser installed')).toHaveTextContent('Installing'),
    );
  });

  it('says the browser is not installed', async () => {
    installFakeApi({
      'GET /meta': meta({ browserInstalled: false, browserInstalling: false }),
    });
    renderApp(<AboutSection />);
    await waitFor(() =>
      expect(valueOf('Browser installed')).toHaveTextContent('No'),
    );
  });

  it('says the values are unavailable when they cannot be read', async () => {
    installFakeApi({ 'GET /meta': failure(503, 'network') });
    renderApp(<AboutSection />);

    await waitFor(() =>
      expect(valueOf('Version')).toHaveTextContent('Unavailable'),
    );
    expect(valueOf('Browser')).toHaveTextContent('Unavailable');
    expect(valueOf('Browser installed')).toHaveTextContent('Unavailable');
  });

  it('has no accessibility violations loading, loaded and unavailable', async () => {
    installFakeApi({ 'GET /meta': meta() });
    const view = renderApp(<AboutSection />);
    await checkAccessibility(view);
    await screen.findByText('Camoufox 152.0.4-beta.30');
    await checkAccessibility(view);
    view.unmount();

    installFakeApi({ 'GET /meta': failure(503, 'network') });
    const failed = renderApp(<AboutSection />);
    await waitFor(() =>
      expect(within(failed.container).getAllByText('Unavailable')).toHaveLength(
        3,
      ),
    );
    await checkAccessibility(failed);
  });
});

import '@testing-library/jest-dom/vitest';
import { Button } from '@tale/ui/button';
import { ContentArea } from '@tale/ui/content-area';
import { MobileFloatingActions } from '@tale/ui/mobile-floating-actions';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { SettingsPage } from './settings-page';
import { SettingsSection } from './settings-section';

import '@/app/globals.css';

afterEach(cleanup);

/** The bounded settings pane above the mobile navigation, with a long form. */
function SettingsFrame({ withActions }: { withActions: boolean }) {
  return (
    <div className="fixed inset-x-0 top-0 bottom-14 flex flex-col">
      <header className="h-14 shrink-0">Settings</header>
      <ContentArea
        data-testid="settings-scroller"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {/* Governance keeps an intermediate bounded flex pane for tables. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <SettingsPage>
            {Array.from({ length: 12 }, (_, index) => (
              <SettingsSection key={index} title={`Setting ${index + 1}`}>
                <p>
                  This setting has an explanation that wraps onto several lines
                  on a narrow display.
                </p>
              </SettingsSection>
            ))}
            <p data-testid="last-setting">
              Currently transcribing audio with local-provider and the selected
              audio model.
            </p>
          </SettingsPage>
        </div>
      </ContentArea>
      {withActions && (
        <MobileFloatingActions>
          <Button variant="secondary" size="sm">
            Discard
          </Button>
          <Button size="sm">Save</Button>
        </MobileFloatingActions>
      )}
    </div>
  );
}

describe('SettingsPage scroll clearance in Chromium', () => {
  it('keeps the last setting above the mobile dock and releases its clearance when actions disappear', async () => {
    await page.viewport(390, 900);
    const { rerender } = render(<SettingsFrame withActions />);
    const scroller = screen.getByTestId('settings-scroller');
    const last = screen.getByTestId('last-setting');
    const save = await screen.findByRole('button', { name: 'Save' });
    const dock = save.parentElement;
    if (dock === null) throw new Error('Missing floating action frame');

    await waitFor(() => {
      scroller.scrollTop = scroller.scrollHeight;
      expect(scroller.scrollTop).toBeGreaterThan(0);
      expect(last.getBoundingClientRect().bottom).toBeLessThan(
        dock.getBoundingClientRect().top - 8,
      );
    });
    const withDockHeight = scroller.scrollHeight;

    rerender(<SettingsFrame withActions={false} />);
    await waitFor(() => {
      scroller.scrollTop = scroller.scrollHeight;
      expect(scroller.scrollHeight).toBeLessThan(withDockHeight - 48);
      const bottomGap =
        scroller.getBoundingClientRect().bottom -
        last.getBoundingClientRect().bottom;
      expect(bottomGap).toBeGreaterThanOrEqual(24);
      expect(bottomGap).toBeLessThan(72);
    });
  });
});

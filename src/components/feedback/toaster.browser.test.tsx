import '@testing-library/jest-dom/vitest';
import * as ToastPrimitives from '@radix-ui/react-toast';
import { Button } from '@tale/ui/button';
import { toastActionGroupClassName } from '@tale/ui/toast';
import { toast } from '@tale/ui/use-toast';
import { act, cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { initServiceI18n } from '../../i18n/init-service';
import { uiMessages } from '../../i18n/messages';
import { Toaster } from './toaster';

import '../../globals.css';

const i18n = initServiceI18n({
  bundles: { en: {}, de: {}, fr: {} },
  regional: {},
  packages: [uiMessages],
});

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('font-size');
});

// The browser owns flex sizing, text reflow and hit testing. A class assertion
// cannot tell us when the Later action has been pushed completely off-screen.
describe.each(['en', 'de', 'fr'])('toast actions in %s', (lng) => {
  it.each([
    [1280, 16],
    [320, 16],
    [320, 32],
  ])(
    'keeps both actions readable at %ipx with %ipx root text',
    async (width, fontSize) => {
      await page.viewport(width, 900);
      document.documentElement.style.fontSize = `${fontSize}px`;
      const later = i18n.t('updateLater', { ns: 'pwa', lng });
      const update = i18n.t('updateNow', { ns: 'pwa', lng });
      const onUpdate = vi.fn();
      render(<Toaster />);
      act(() => {
        toast({
          duration: Infinity,
          title: i18n.t('updateAvailableTitle', { ns: 'pwa', lng }),
          description: i18n.t('updateAvailableDescription', { ns: 'pwa', lng }),
          action: (
            <div className={toastActionGroupClassName}>
              <ToastPrimitives.Close asChild>
                <Button type="button" variant="ghost" size="sm">
                  {later}
                </Button>
              </ToastPrimitives.Close>
              <ToastPrimitives.Action
                altText={update}
                asChild
                onClick={onUpdate}
              >
                <Button type="button" size="sm">
                  {update}
                </Button>
              </ToastPrimitives.Action>
            </div>
          ),
        });
      });
      await document.fonts.ready;
      const buttons = [
        screen.getByRole('button', { name: later }),
        screen.getByRole('button', { name: update }),
      ];
      const root = buttons[0].closest('li');
      expect(root).not.toBeNull();
      if (!root) return;
      await waitFor(() => {
        const bounds = root.getBoundingClientRect();
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(width);
        expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
        for (const button of buttons) {
          const box = button.getBoundingClientRect();
          expect(box.left).toBeGreaterThanOrEqual(bounds.left);
          expect(box.right).toBeLessThanOrEqual(bounds.right);
          expect(button.scrollWidth).toBeLessThanOrEqual(
            button.clientWidth + 1,
          );
          expect(
            button.contains(
              document.elementFromPoint(
                box.left + box.width / 2,
                box.top + box.height / 2,
              ),
            ),
          ).toBe(true);
        }
        const copy = root.querySelector('.grid');
        expect(copy).not.toBeNull();
        expect(
          buttons[0].parentElement?.getBoundingClientRect().top,
        ).toBeGreaterThanOrEqual(
          copy?.getBoundingClientRect().bottom ?? Infinity,
        );
      });
      await page.getByRole('button', { name: update }).click();
      expect(onUpdate).toHaveBeenCalledOnce();
    },
  );
});

it('keeps a short single action beside the copy', async () => {
  await page.viewport(1280, 800);
  render(<Toaster />);
  act(() => {
    toast({
      duration: Infinity,
      title: 'Saved',
      action: (
        <Button type="button" size="sm">
          View
        </Button>
      ),
    });
  });
  const button = screen.getByRole('button', { name: 'View' });
  const copy = screen.getByText('Saved');
  await waitFor(() => {
    expect(button.getBoundingClientRect().top).toBeLessThan(
      copy.getBoundingClientRect().bottom,
    );
    expect(button.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      copy.getBoundingClientRect().right,
    );
  });
});

it('lets keyboard users scroll a tall notice to its actions', async () => {
  await page.viewport(320, 500);
  document.documentElement.style.fontSize = '32px';
  render(<Toaster />);
  act(() => {
    toast({
      duration: Infinity,
      title: 'A new version is available',
      description:
        'This tab is running an older version. Some content could not be loaded. Save your changes, then reload to continue with the updated version.',
      action: (
        <div className={toastActionGroupClassName}>
          <Button type="button" size="sm">
            Update now
          </Button>
        </div>
      ),
    });
  });
  await document.fonts.ready;
  const button = screen.getByRole('button', { name: 'Update now' });
  const root = button.closest('li');
  expect(root).not.toBeNull();
  if (!root) return;
  root.focus();
  expect(document.activeElement).toBe(root);
  await userEvent.keyboard('{End}');
  await waitFor(() => {
    expect(root.scrollTop).toBeGreaterThan(0);
    const bounds = button.getBoundingClientRect();
    expect(bounds.bottom).toBeLessThanOrEqual(500);
    expect(
      button.contains(
        document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        ),
      ),
    ).toBe(true);
  });
});

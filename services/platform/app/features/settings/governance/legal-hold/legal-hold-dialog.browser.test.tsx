import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { deriveAccentPalette } from '@/lib/utils/color';
import { inkContrast } from '@/tests/utils/paint';
import { cleanup, render, screen } from '@/tests/utils/render';

import { ActiveHoldsSection } from './active-holds-section';

import '@/app/globals.css';

vi.mock('../hooks/queries', () => ({
  useLegalHolds: () => ({ data: [], isLoading: false }),
  useLegalMatters: () => ({ data: [], isLoading: false }),
  useOrgMembersForPicker: () => ({ data: [], isLoading: false }),
}));
vi.mock('../hooks/mutations', () => ({
  usePlaceLegalHold: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpsertLegalMatter: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRequestLegalHoldRelease: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('style');
});

describe.each([undefined, '#0066CC', '#0B0B2A', '#443366', '#F5F5F0'])(
  'legal-hold matter creation with accent %s',
  (accent) => {
    it.each(['light', 'dark'] as const)(
      'stays legible and keyboard reachable in %s mode',
      async (theme) => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        if (accent) {
          const palette = deriveAccentPalette(accent, theme);
          document.documentElement.style.setProperty(
            '--primary',
            palette.textHsl,
          );
          document.documentElement.style.setProperty('--ring', palette.textHsl);
        }
        render(<ActiveHoldsSection organizationId="org-1" />);
        await userEvent.click(
          screen.getByRole('button', { name: 'Place legal hold' }),
        );
        await userEvent.click(screen.getByLabelText('Matter'));
        const create = await screen.findByRole('button', {
          name: 'Create new matter…',
        });

        expect(
          inkContrast(create),
          'resting text on the real popover',
        ).toBeGreaterThanOrEqual(4.5);
        await userEvent.hover(create);
        await expect
          .poll(() => inkContrast(create), {
            message: 'hovered text on the real popover',
          })
          .toBeGreaterThanOrEqual(4.5);

        for (let tab = 0; tab < 5 && document.activeElement !== create; tab++) {
          await userEvent.tab();
        }
        expect(create).toHaveFocus();
        expect(getComputedStyle(create).outlineStyle).not.toBe('none');
        expect(
          parseFloat(getComputedStyle(create).outlineWidth),
        ).toBeGreaterThan(0);
        await userEvent.keyboard('{Enter}');
        expect(
          await screen.findByRole('dialog', { name: 'Create matter' }),
        ).toBeInTheDocument();
      },
    );
  },
);

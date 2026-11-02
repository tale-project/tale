import type { Page } from '@playwright/test';
import { MOBILE_MAX_WIDTH } from '@tale/ui/use-is-mobile';
import { describe, expect, it, vi } from 'vitest';

import { PRODUCT_SCREENSHOTS } from '../../../web/app/content/product-screenshots';
import { CAPTURE_LOCALES } from './capture-options';
import { t, withCaptureLocale } from './i18n';
import {
  DEFAULT_VIEWPORT,
  PHONE_VIEWPORT,
  SHOTS,
  shotViewport,
  type Shot,
} from './manifest';

describe('native marketing capture readiness', () => {
  it('pairs every marketing source with data and native route-topic readiness', () => {
    for (const { source } of Object.values(PRODUCT_SCREENSHOTS)) {
      const shot = SHOTS.find(({ name }) => name === source);
      expect(shot, `Capture manifest is missing ${source}`).toBeDefined();
      expect(shot?.readyWhen).toBeTypeOf('function');
      expect(
        shot?.localizedReadyWhen,
        `${source} must wait for its translated controls`,
      ).toBeTypeOf('function');
    }
  });

  it('waits for the native Inbox radio with its unread-count accessible suffix', () => {
    const shot = SHOTS.find(({ name }) => name === 'home-inbox');
    const getByRole = vi.fn();
    const page = { getByRole } as unknown as Page;
    for (const locale of CAPTURE_LOCALES) {
      withCaptureLocale(locale, () => {
        shot?.localizedReadyWhen?.(page, {
          orgId: 'demo',
          device: 'desktop',
          threads: new Map(),
          projects: new Map(),
        });
        const [role, options] = getByRole.mock.lastCall ?? [];
        expect(role).toBe('radio');
        expect(options?.name).toBeInstanceOf(RegExp);
        expect(
          options?.name.test(`${t('home.views.inbox')} , 2 items need you`),
        ).toBe(true);
        expect(options?.name.test(t('home.views.tasks'))).toBe(false);
      });
    }
  });
});

describe('phone captures', () => {
  const desktopWidth = (shot: Shot) => shotViewport(shot, 'desktop')?.width;
  const wide = SHOTS.filter(
    (shot) => (desktopWidth(shot) ?? 0) > MOBILE_MAX_WIDTH,
  );

  it('captures the desktop layout above the md breakpoint and the phone layout below it', () => {
    expect(DEFAULT_VIEWPORT.width).toBeGreaterThan(MOBILE_MAX_WIDTH);
    expect(PHONE_VIEWPORT.width).toBeLessThanOrEqual(MOBILE_MAX_WIDTH);
    for (const shot of SHOTS) {
      expect(
        shotViewport(shot, 'desktop'),
        `${shot.name} has a desktop capture`,
      ).toEqual(shot.viewport ?? DEFAULT_VIEWPORT);
      const phone = shotViewport(shot, 'phone');
      if (phone)
        expect(
          phone.width,
          `${shot.name}'s phone capture must get the phone layout`,
        ).toBeLessThanOrEqual(MOBILE_MAX_WIDTH);
    }
  });

  // Below 768 px Tale lays out every surface anew, so a shot captured wider
  // than that has a phone capture unless it opts out and says why.
  it('gives every wide shot a phone capture, or a reason it has none', () => {
    for (const shot of wide) {
      const optOut =
        shot.phone && 'none' in shot.phone ? shot.phone.none : null;
      if (optOut === null)
        expect(
          shotViewport(shot, 'phone'),
          `${shot.name} has a phone capture`,
        ).not.toBeNull();
      else {
        expect(optOut.trim(), `${shot.name} says why it has none`).not.toBe('');
        expect(shotViewport(shot, 'phone')).toBeNull();
      }
    }
  });

  // A shot captured below 768 px already is the phone layout: a phone
  // declaration on it would be ignored, so it is refused instead.
  it('declares no phone capture on a shot that already is the phone layout', () => {
    const narrow = SHOTS.filter((shot) => !wide.includes(shot));
    expect(narrow.map(({ name }) => name).sort()).toEqual([
      'agent-consent',
      'automation-editor-canvas-mobile',
    ]);
    for (const shot of narrow) {
      expect(
        shot.phone,
        `${shot.name} declares a phone capture`,
      ).toBeUndefined();
      expect(shotViewport(shot, 'phone')).toBeNull();
    }
  });
});

import type { Page } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';

import { PRODUCT_SCREENSHOTS } from '../../../web/app/content/product-screenshots';
import { CAPTURE_LOCALES } from './capture-options';
import { t, withCaptureLocale } from './i18n';
import { SHOTS } from './manifest';

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

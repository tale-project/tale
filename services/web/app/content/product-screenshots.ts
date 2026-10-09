/** Real, synthetic-workspace captures owned by the documentation capture manifest.
 * Crops only change framing; no product pixels or state are reconstructed.
 * Regenerate derivatives with `bun run --filter @tale/web optimize-images --product-screens`.
 */
export const PRODUCT_SCREENSHOTS = {
  home: {
    source: 'project-task-detail',
    crop: { left: 0, top: 0, width: 1470, height: 1700 },
  },
  hub: {
    source: 'home-inbox',
    crop: { left: 106, top: 0, width: 564, height: 680 },
  },
  agents: {
    source: 'project-agents-models',
    desktopCrop: { left: 670, top: 0, width: 2210, height: 800 },
    crop: { left: 1000, top: 430, width: 1100, height: 370 },
  },
  chat: {
    source: 'chat-thread-reply',
    crop: { left: 1035, top: 465, width: 940, height: 520 },
  },
  projects: {
    source: 'projects-task-board',
    desktopCrop: { left: 670, top: 0, width: 3810, height: 1050 },
    crop: { left: 1290, top: 330, width: 610, height: 600 },
  },
  automations: {
    source: 'automation-run-detail',
    crop: { left: 1150, top: 300, width: 750, height: 1310 },
  },
  knowledge: {
    source: 'knowledge-entries-list',
    desktopCrop: { left: 0, top: 0, width: 2880, height: 840 },
    crop: { left: 130, top: 230, width: 900, height: 610 },
  },
  governance: {
    source: 'governance-audit-logs',
    crop: { left: 1035, top: 610, width: 815, height: 420 },
  },
} as const;

export type ProductScreenshotPage = keyof typeof PRODUCT_SCREENSHOTS;

export const PRODUCT_SCREENSHOT_LOCALES = ['en', 'de', 'fr'] as const;
export type ProductScreenshotLocale =
  (typeof PRODUCT_SCREENSHOT_LOCALES)[number];

export function productScreenshotLocale(
  locale: string,
): ProductScreenshotLocale {
  switch (locale) {
    case 'de':
    case 'de-CH':
      return 'de';
    case 'fr':
      return 'fr';
    default:
      return 'en';
  }
}

export function productScreenshotId(source: string, locale: string): string {
  return `${source}-${productScreenshotLocale(locale)}`;
}

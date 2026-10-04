export { createPlaywrightConfig, devices } from './config.ts';
export type { CreatePlaywrightConfigOptions } from './config.ts';
export { createI18n } from './i18n.ts';
export type { I18nResolver } from './i18n.ts';
export { collectConsoleErrors, expectPageRenders } from './smoke.ts';

// Standalone diagnostics use the same declared browser driver as the E2E suite.
export { chromium } from '@playwright/test';
export type { CDPSession, Page } from '@playwright/test';

/**
 * Public surface of the centralized i18n test framework.
 *
 * Consumers (every service's `messages.test.ts`, the docs corpus test, and
 * the plop templates) import from `@tale/ui/i18n/tests`. The framework
 * supersedes the standalone `parity` and `usage` modules; consumers call
 * `defineI18nTests` / `defineDocsTests`.
 */

// New unified entry points.
export { defineI18nTests } from './define-i18n-tests';
export { defineDocsTests } from './define-docs-tests';

// Public types.
export type {
  CheckId,
  CheckMode,
  ModeMap,
  I18nTestsConfig,
  DocsTestsConfig,
} from './config';
export type { Finding, Check, CheckContext } from './checks/types';
export type { LocaleConfig } from './locales/types';
export type { Term, Category, GlossaryHandle } from './glossary/types';

// Locale registry surfaces.
export { LOCALE_REGISTRY, getLocaleConfig, resolveFallback } from './locales';

// Glossary surfaces.
export { loadGlossary } from './glossary/loader';

// Shared data for docs-structural tests in `services/docs/tests/`.
export { stubsForLocale } from './data/heading-stubs';
export { STATUS_CHATTER } from './data/status-chatter';
export type { StatusChatterEntry } from './data/status-chatter';

// Scanner helpers (used by external scripts like `glossary-audit.ts`).
export {
  walkDocsRoot,
  walkMessagesDir,
  lexIcu,
  slugifyHeading,
  extractHeadingSlugs,
} from './scanner';
export type { Fragment, Source, JsonSource, MarkdownSource } from './scanner';

// Internal regex helpers (used by `glossary-audit.ts`).
export {
  escapeRegex,
  wordBoundary,
  wordBoundaryDe,
  wordBoundaryFr,
} from './internals/regex';

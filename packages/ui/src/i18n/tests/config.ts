/**
 * Public configuration types for the centralized i18n test framework.
 *
 * Each consumer (each services lib/i18n/messages.test.ts, the docs corpus test
 * at `services/docs/tests/docs.test.ts`, and the two plop templates) calls
 * `defineI18nTests` or `defineDocsTests` from the @tale/ui i18n tests package with a
 * config object. Every field but `serviceRoot` / `docsRoot` is optional;
 * defaults are explicit and inspectable. No magic.
 *
 * Mode mechanics — checks run in one of three modes:
 *   - `enforce`: a violation fails the test suite.
 *   - `report`: a violation is collected into the end-of-run summary; the
 *     test passes. Used for new checks during the rollout, and for
 *     heuristic checks (e.g. glossary-coverage) whose findings are advisory.
 *   - `off`: the check is skipped entirely. No scanner work for it.
 */

/** The stable id of every check the framework ships. */
export type CheckId =
  | 'parity'
  | 'usage'
  | 'usage-missing'
  | 'pronouns-formal'
  | 'terminology-loanword'
  | 'terminology-half-compound'
  | 'terminology-ui-label'
  | 'voice-strikes'
  | 'voice-drift'
  | 'grammar-articles'
  | 'style-quotes'
  | 'style-apostrophes'
  | 'style-em-dash'
  | 'style-en-dash'
  | 'style-nbsp'
  | 'style-numbers'
  | 'style-dates'
  | 'style-percent-nbsp'
  | 'style-currency'
  | 'style-ss'
  | 'icu-brace-balance'
  | 'icu-placeholder-parity'
  | 'icu-plural-rules'
  | 'glossary-coverage'
  | 'status-chatter'
  | 'prose-exclamation'
  | 'markdown-anchor-parity'
  | 'markdown-link-target'
  | 'placeholder-density';

export type CheckMode = 'enforce' | 'report' | 'off';

/** Per-check mode override. Omitted entries fall back to the check's default. */
export type ModeMap = Partial<Record<CheckId, CheckMode>>;

/**
 * Config for `defineI18nTests` — used by each service's `messages.test.ts`.
 *
 * The framework reads `<messagesDir>/<locale>.yml` for every locale in
 * `LOCALE_REGISTRY` that has a file present, plus `<messagesDir>/global.yml`
 * (or whatever is listed in `sharedFiles`) which is spread into every locale
 * and therefore skipped from parity comparisons.
 *
 * Usage-check semantics are unchanged from the existing module: keys defined
 * in `baseFiles` (default `['en.json', 'global.json']`) must be referenced by
 * source code in `scanRoots`, or appear under a prefix listed in the optional
 * `<serviceRoot>/lib/i18n/keys-dynamic.yml` allowlist.
 */
export interface I18nTestsConfig {
  /** Absolute path to the service root (e.g. `services/web`). Required. */
  serviceRoot: string;

  /** Override the messages directory. Defaults to `<serviceRoot>/messages`. */
  messagesDir?: string;

  /**
   * Source roots scanned by the usage check for `t()` / `useT()` / dotted
   * literals. Defaults to `['app', 'components', 'hooks', 'lib', 'convex']`;
   * missing roots are skipped without error.
   */
  scanRoots?: string[];

  /**
   * Allowlist of dynamic-key prefixes (e.g. `permission.action.`) excluded
   * from the orphan-key check. Defaults to
   * `<serviceRoot>/lib/i18n/keys-dynamic.yml`. The file is optional.
   */
  allowlistPath?: string;

  /** Pretty path printed in failure messages. Inferred when omitted. */
  allowlistDisplayPath?: string;

  /** Base locale every primary locale must match. Defaults to `'en'`. */
  baseLocale?: string;

  /** Spread-into-every-locale files. Defaults to `['global.json']`. */
  sharedFiles?: string[];

  /**
   * Per-check mode overrides. Defaults per check are listed in the registry;
   * see `packages/ui/src/i18n/tests/registry.ts`. Set a check to `'off'`
   * to skip it entirely for this service.
   */
  modes?: ModeMap;

  /**
   * Restrict the active locale set. By default every locale in
   * `LOCALE_REGISTRY` with a present `<locale>.yml` file under `messagesDir`
   * is considered.
   */
  locales?: ReadonlyArray<string>;
}

/**
 * Config for `defineDocsTests` — used by `services/docs/tests/docs.test.ts`.
 * Walks the markdown content tree at `docsRoot` (typically `<repo>/docs`).
 * The optional `navPath` is used by `markdown-anchor-parity` to resolve
 * link targets.
 */
export interface DocsTestsConfig {
  /** Absolute path to the markdown content root (e.g. `<repo>/docs`). */
  docsRoot: string;

  /** Path to the nav.json file. Defaults to `<docsRoot>/nav.json`. */
  navPath?: string;

  /**
   * Path to the glossary JSON. Defaults to the framework-bundled
   * `packages/ui/src/i18n/tests/glossary/glossary.yml`.
   */
  glossaryPath?: string;

  /** Per-check mode overrides. */
  modes?: ModeMap;

  /** Locale restriction; see `I18nTestsConfig.locales`. */
  locales?: ReadonlyArray<string>;
}

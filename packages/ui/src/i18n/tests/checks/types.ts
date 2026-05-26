/**
 * Internal contract for every check module under `checks/`.
 *
 * A check is a pure function from `CheckContext` to `Finding[]`. It performs
 * no I/O of its own — the scanner has already produced fragments, the
 * glossary loader is exposed as a thunk on the context, the locale registry
 * has already filtered to applicable locales. A check's only job is to
 * inspect fragments and decide whether each one violates its rule.
 *
 * Mode dispatch (enforce / report / off) happens around the check, not
 * inside it: `define-i18n-tests` reads the configured mode and wraps the
 * findings in `assertFindings`.
 */

import type { CheckId, CheckMode } from '../config';
import type { GlossaryHandle } from '../glossary/types';
import type { LocaleConfig } from '../locales/types';
import type { Scanner } from '../scanner';

/** A rule violation. Immutable; the framework never mutates findings. */
export interface Finding {
  /** Repo-relative path. */
  readonly file: string;
  /** 1-based line number. `0` for whole-file findings. */
  readonly line: number;
  /** 1-based column. */
  readonly column?: number;
  /** Dotted JSON key path for JSON findings. */
  readonly key?: string;
  /** Locale of the source file. */
  readonly locale: string;
  /** Stable rule subtag (`de-wird-passive`, `quotes-ascii`). */
  readonly rule: string;
  /** Human-readable description, ending without punctuation. */
  readonly detail: string;
  /** Concrete fix suggestion, when applicable. */
  readonly suggest?: string;
  /** Pointer to the doctrine file/section for the curious reviewer. */
  readonly doctrine?: string;
}

/** Run-time context passed to every check. */
export interface CheckContext {
  /** Locales active for this run (already filtered by registry + service). */
  readonly locales: ReadonlyArray<LocaleConfig>;
  /** Service root, when running under `defineI18nTests`. */
  readonly serviceRoot?: string;
  /** Messages dir, when running under `defineI18nTests`. */
  readonly messagesDir?: string;
  /** Docs root, when running under `defineDocsTests`. */
  readonly docsRoot?: string;
  /** Nav path, when running under `defineDocsTests`. */
  readonly navPath?: string;
  /** Scan roots for the usage check (source-walk). */
  readonly scanRoots?: ReadonlyArray<string>;
  /** Allowlist path for the usage check. */
  readonly allowlistPath?: string;
  /** Display path for the allowlist in usage-check failure messages. */
  readonly allowlistDisplayPath?: string;
  /** Lazy glossary handle. Cached for the run. */
  readonly glossary: () => GlossaryHandle;
  /** Scanner used to iterate fragments. */
  readonly scanner: Scanner;
}

/** Spec used by `createCheck`. Same shape as `Check`; the factory is a typed
 *  identity function — but kept so we can attach invariants later. */
export interface CheckSpec {
  readonly id: CheckId;
  readonly scope: 'json' | 'markdown' | 'both';
  readonly defaultMode: CheckMode;
  /** Optional predicate to skip non-applicable locales (e.g. `style-ss`
   *  only applies to locales with `allowSharpS: false`). */
  readonly localeFilter?: (locale: LocaleConfig) => boolean;
  run(ctx: CheckContext): Finding[];
}

export interface Check extends CheckSpec {}

/** Typed factory. Reserves the option of normalising specs later. */
export function createCheck(spec: CheckSpec): Check {
  return spec;
}

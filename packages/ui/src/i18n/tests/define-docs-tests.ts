/**
 * Public entry point for the docs markdown corpus test.
 *
 * Walks `<docsRoot>/<locale>/**` for each active locale and registers the
 * markdown-scoped (or both-scoped) checks.
 */

import { describe, it } from 'vitest';

import type { CheckContext } from './checks/types';
import type { DocsTestsConfig } from './config';
import { loadGlossary } from './glossary/loader';
import { assertFindings } from './internals/findings';
import { LOCALE_REGISTRY } from './locales';
import { CHECKS } from './registry';
import { createScanner } from './scanner';
import { walkDocsRoot } from './scanner/walk';

export function defineDocsTests(config: DocsTestsConfig): void {
  const requestedLocales = config.locales
    ? [...config.locales]
    : LOCALE_REGISTRY.map((l) => l.id);

  const sources = walkDocsRoot(config.docsRoot, requestedLocales);
  const presentLocales = new Set(sources.map((s) => s.locale));
  const activeLocales = LOCALE_REGISTRY.filter((l) => presentLocales.has(l.id));
  const repoRoot = config.docsRoot.replace(/\/$/, '').replace(/\/docs$/, '');
  const scanner = createScanner(sources, repoRoot);

  let glossaryHandle: ReturnType<typeof loadGlossary> | null = null;

  const context: CheckContext = {
    locales: activeLocales,
    docsRoot: config.docsRoot,
    navPath: config.navPath,
    glossary: () => {
      if (!glossaryHandle) glossaryHandle = loadGlossary(config.glossaryPath);
      return glossaryHandle;
    },
    scanner,
  };

  describe('docs', () => {
    for (const check of CHECKS) {
      if (check.scope === 'json') continue;
      const mode = config.modes?.[check.id] ?? check.defaultMode;
      if (mode === 'off') continue;
      describe(check.id, () => {
        const applicableLocales = check.localeFilter
          ? activeLocales.filter(check.localeFilter)
          : activeLocales;
        if (applicableLocales.length === 0) return;
        const scopedCtx: CheckContext = {
          ...context,
          locales: applicableLocales,
        };
        it(`runs in ${mode} mode`, () => {
          const findings = check.run(scopedCtx);
          const doctrine = findings.find((f) => f.doctrine)?.doctrine;
          assertFindings(findings, mode, {
            checkId: check.id,
            label: check.id,
            doctrine,
          });
        });
      });
    }
  });
}

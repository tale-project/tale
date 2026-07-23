/**
 * Public entry point — used by every service's `messages.test.ts`.
 *
 * Reads the config, builds the active locale list, walks the messages
 * directory for JSON sources, and registers a vitest `describe` per check.
 * Mode dispatch goes through `assertFindings`.
 *
 * The `parity` and `usage` checks emit their own `describe`/`it` blocks
 * via the existing modules they wrap; the framework calls them at register
 * time and skips `assertFindings` (their findings are `[]`).
 */

import path from 'node:path';

import { describe, it } from 'vitest';

import type { CheckContext } from './checks/types';
import type { I18nTestsConfig, ModeMap } from './config';
import { loadGlossary } from './glossary/loader';
import { assertFindings } from './internals/findings';
import { resolveRepoRoot } from './internals/paths';
import { LOCALE_REGISTRY } from './locales';
import { CHECKS } from './registry';
import { createScanner } from './scanner';
import { walkMessagesDir } from './scanner/walk';

export function defineI18nTests(config: I18nTestsConfig): void {
  const repoRoot = resolveRepoRoot(config.serviceRoot);
  const messagesDir =
    config.messagesDir ?? path.join(config.serviceRoot, 'messages');
  const sharedFiles = config.sharedFiles ?? ['global.yml'];
  const requestedLocales = config.locales
    ? [...config.locales]
    : LOCALE_REGISTRY.map((l) => l.id);

  const presentSources = walkMessagesDir(
    messagesDir,
    requestedLocales,
    sharedFiles,
  );
  const presentLocales = new Set(presentSources.map((s) => s.locale));
  // Always include the base locale (en) in the context so terminology checks
  // can resolve glossary against it even if en.yml is shared elsewhere.
  presentLocales.add(config.baseLocale ?? 'en');

  const activeLocales = LOCALE_REGISTRY.filter((l) => presentLocales.has(l.id));
  const scanner = createScanner(presentSources, repoRoot);
  let glossaryHandle: ReturnType<typeof loadGlossary> | null = null;

  const context: CheckContext = {
    locales: activeLocales,
    serviceRoot: config.serviceRoot,
    messagesDir,
    scanRoots: config.scanRoots,
    allowlistPath: config.allowlistPath,
    allowlistDisplayPath: config.allowlistDisplayPath,
    glossary: () => {
      if (!glossaryHandle) glossaryHandle = loadGlossary();
      return glossaryHandle;
    },
    scanner,
  };

  registerChecks(context, config.modes, 'json');
}

function registerChecks(
  ctx: CheckContext,
  modes: ModeMap | undefined,
  scopeFilter: 'json' | 'markdown' | 'both',
): void {
  describe('i18n', () => {
    for (const check of CHECKS) {
      const applicable =
        scopeFilter === 'both' ||
        check.scope === scopeFilter ||
        check.scope === 'both';
      if (!applicable) continue;
      const mode = modes?.[check.id] ?? check.defaultMode;
      if (mode === 'off') continue;
      describe(check.id, () => {
        // Filter locales per check.
        const applicableLocales = check.localeFilter
          ? ctx.locales.filter(check.localeFilter)
          : ctx.locales;
        if (
          applicableLocales.length === 0 &&
          check.id !== 'parity' &&
          check.id !== 'usage'
        ) {
          return;
        }
        const scopedCtx: CheckContext = { ...ctx, locales: applicableLocales };
        if (check.id === 'parity' || check.id === 'usage') {
          // These two register their own describe/it via the wrapped module.
          check.run(scopedCtx);
          return;
        }
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

/**
 * Voice/pronoun/terminology guard for the translated documentation corpus.
 *
 * Wires the shared i18n framework's `defineDocsTests` against `docs/<locale>/**`
 * prose. Before this file, `defineDocsTests` was exported but never called, so
 * the per-locale voice doctrine (`du` for de, `tu` for fr — see
 * `.agents/skills/write-translations/locales/*​/AGENTS.md`) ran only against the
 * message-catalog JSON, never against the documentation pages themselves.
 *
 * Every markdown- and `both`-scoped check now runs against the docs tree. Mode
 * follows the framework's rollout convention (see `config.ts`): checks whose
 * corpus is already clean stay on their `enforce` default; checks that surface
 * pre-existing violations run in `report` (findings are collected into the
 * end-of-run summary without failing the suite) so the guard lands green and
 * can be ratcheted to `enforce` file-by-file as the corpus is converted.
 *
 * The DE/FR docs prose is currently written pervasively in formal voice
 * (`Sie`/`vous`), so `pronouns-formal` starts in `report`; flip it to `enforce`
 * once the corpus is converted to the informal `du`/`tu` doctrine.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineDocsTests } from '@tale/ui/i18n/tests';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `docs/` — the content tree the docs site reads from. */
const DOCS_ROOT = path.resolve(HERE, '../../../docs');

defineDocsTests({
  docsRoot: DOCS_ROOT,
  modes: {
    // Pinned to `report` until the docs corpus is converted; each currently
    // carries pre-existing violations. Ratchet to `enforce` per check once
    // clean. See the run summary for the outstanding findings.
    'pronouns-formal': 'report',
    'terminology-loanword': 'report',
    'terminology-ui-label': 'report',
    'voice-strikes': 'report',
    'grammar-articles': 'report',
    // Already enforced by the docs service's own `structure-prose.test.ts`
    // (with its markdown-context carve-outs); kept in `report` here to avoid a
    // second, differently-scoped enforcement of the same rule.
    'prose-exclamation': 'report',
  },
});

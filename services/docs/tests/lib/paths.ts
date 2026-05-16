import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Path constants used across the docs test suite.
 *
 * Layout reminder:
 *   <repo>/
 *     docs/                        ← content tree (CONTENT_ROOT)
 *       en/, de/, fr/, de-CH/
 *     services/
 *       docs/                      ← this service (DOCS_ROOT)
 *         tests/
 *           lib/
 *             paths.ts             ← this file
 *       platform/
 *         messages/                ← shipped UI strings (MESSAGES_ROOT)
 *           en.json, de.json, fr.json
 *     .agents/terminology/
 *       GLOSSARY.json              ← term contract (GLOSSARY_PATH)
 *
 * Resolved once at module-load time. No filesystem checks here — that lives in
 * `walk.ts`. Keeping this file pure makes the helpers easy to unit-test and
 * stops circular imports between modules that only want the path.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `services/docs/tests/`. */
export const TESTS_ROOT = path.resolve(HERE, '..');

/** `services/docs/`. */
export const DOCS_ROOT = path.resolve(TESTS_ROOT, '..');

/** Repo root — three levels up from `services/docs/`. */
export const REPO_ROOT = path.resolve(DOCS_ROOT, '..', '..');

/** `docs/` — the content tree the docs site reads from. */
export const CONTENT_ROOT = path.join(REPO_ROOT, 'docs');

/** `services/platform/messages/` — the shipped-UI source of truth. */
export const MESSAGES_ROOT = path.join(
  REPO_ROOT,
  'services',
  'platform',
  'messages',
);

/** `.agents/terminology/GLOSSARY.json` — the term contract consumed by the
 *  terminology, loanword, and compound tests. */
export const GLOSSARY_PATH = path.join(
  REPO_ROOT,
  '.agents',
  'terminology',
  'GLOSSARY.json',
);

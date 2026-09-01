'use node';

/**
 * The ONE read path for a per-domain org-config file — YAML first, JSON
 * fallback.
 *
 * The on-disk constitution is YAML-first with JSON accepted everywhere, and
 * org trees are converted `.json`→`.yml` org by org (a versioned node
 * migration), so both formats MUST read correctly at the same time: an org
 * whose tree is already converted reads `<fileBase>.yml`; one that is not
 * yet converted falls back to `<fileBase>.json`. Every per-domain reader
 * (the file→`configCache` sync, the SSO connection reader, the retention
 * area reader, …) resolves a file through this helper so that order is
 * defined exactly once. A `.yml` that exists but is corrupt is an ERROR,
 * never a silent fall-through to a stale `.json` sibling — the sibling is
 * superseded, not authoritative.
 *
 * Parsing goes through the shared safe YAML loader for `.yml` and plain
 * `JSON.parse` for `.json`; both funnel into the caller's `validate`
 * (typically a Zod schema parse), which stays the source of truth for the
 * shape. Symlink refusal, size caps, and O_NOFOLLOW reads come from the
 * same `readJsonFile` guards every JSON reader already used.
 */

import { parseYamlOrThrow } from '../../../../lib/shared/config/yaml';
import {
  readJsonFile,
  safeJoinWithinDir,
  type FileReadResult,
} from '../file_io';

/** On-disk formats a domain config file may currently be in. */
export type DomainFileFormat = 'yaml' | 'json';

export type DomainFileReadResult<T> = FileReadResult<T> & {
  /** Format of the file that was actually read (present on `ok` results). */
  format?: DomainFileFormat;
};

/**
 * Read `<dir>/<fileBase>.yml`, falling back to `<dir>/<fileBase>.json` only
 * when the `.yml` is ABSENT. `validate` receives the parsed plain data and
 * must throw on an invalid shape (its message lands in the `corrupted`
 * result). Returns the standard `FileReadResult` plus the format that was
 * read, so writers can snapshot/supersede the right sibling.
 */
export async function readDomainConfigFile<T>(
  dir: string,
  fileBase: string,
  maxSizeBytes: number,
  validate: (data: unknown) => T,
): Promise<DomainFileReadResult<T>> {
  // safeJoinWithinDir (not a bare join): `fileBase` always comes from a
  // registry today, but the traversal guard keeps that a defense-in-depth
  // invariant instead of a call-site convention.
  const yamlPath = safeJoinWithinDir(dir, `${fileBase}.yml`);
  const yamlResult = await readJsonFile(yamlPath, maxSizeBytes, (content) =>
    validate(parseYamlOrThrow(content)),
  );
  if (yamlResult.ok) {
    return { ...yamlResult, format: 'yaml' };
  }
  if (yamlResult.error !== 'not_found') {
    // readJsonFile phrases parse failures as "Invalid JSON in …"; re-label
    // for the YAML branch so operators are pointed at the right syntax.
    if (yamlResult.error === 'corrupted') {
      return {
        ...yamlResult,
        message: yamlResult.message.replace(/^Invalid JSON in/, 'Invalid'),
      };
    }
    return yamlResult;
  }

  const jsonPath = safeJoinWithinDir(dir, `${fileBase}.json`);
  const jsonResult = await readJsonFile(jsonPath, maxSizeBytes, (content) =>
    validate(JSON.parse(content) as unknown),
  );
  if (jsonResult.ok) {
    return { ...jsonResult, format: 'json' };
  }
  return jsonResult;
}

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import type { Json } from './spec.ts';

/**
 * The "API contract changes" section of a release's notes, generated from
 * what the two tags actually published: `contract-fingerprint.json`'s
 * version at the previous tag and at the new one, the operations of the two
 * `public/openapi.json` documents, and the changelog paragraph the new
 * version carries in `lib/shared/constants/api-contract.ts`. The release
 * workflow prepends it to GitHub's generated notes, so a client pinned to
 * `info.version` reads every bump where the API reference says it will —
 * the 1.20.0 → 1.21.0 bump (v0.5.54) shipped under a bare "What's Changed"
 * list because nobody wrote the section by hand (2026-09-26 evaluation).
 */

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Every `METHOD /path` an OpenAPI document publishes, sorted. */
export function listOperations(spec: Json): string[] {
  const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;
  const operations: string[] = [];
  for (const [path, byMethod] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      if (byMethod[method] !== undefined) {
        operations.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return operations.sort();
}

/**
 * The changelog paragraph(s) for `version` in the `api-contract.ts` doc
 * block: every line from ` * <version> — ` up to the next ` * <semver> — `
 * entry or the end of the block, joined into prose. Empty when the version
 * has no entry — the section then says so rather than inventing one.
 */
export function changelogEntry(source: string, version: string): string {
  const entryStart = /^\s*\*\s+(\d+\.\d+\.\d+)\s+—\s/;
  const lines = source.split(/\r?\n/);
  const collected: string[] = [];
  let inside = false;
  for (const line of lines) {
    const start = entryStart.exec(line);
    if (start) {
      if (inside) break;
      if (start[1] === version) inside = true;
    } else if (inside && /^\s*\*\/\s*$/.test(line)) {
      break;
    }
    if (inside) collected.push(line.replace(/^\s*\*\s?/, '').trim());
  }
  return collected
    .join('\n')
    .replace(/\n\n+/g, '\u0000')
    .replace(/\n/g, ' ')
    .replace(/\u0000/g, '\n\n')
    .trim();
}

export interface ContractSnapshot {
  version: string;
  operations: string[];
}

export interface ContractNotesInput {
  /** The previous tag's snapshot, or null when no fingerprint was recorded there. */
  previous: ContractSnapshot | null;
  previousTag: string;
  current: ContractSnapshot;
  /** The `api-contract.ts` source at the new tag. */
  changelog: string;
}

/** The markdown section, heading included. */
export function contractChangesSection(input: ContractNotesInput): string {
  const { previous, previousTag, current, changelog } = input;
  const lines = ['## API contract changes', ''];
  if (previous === null) {
    lines.push(
      `No contract fingerprint was recorded at ${previousTag}, so this range cannot be compared. The contract is at ${current.version}: ${current.operations.length} operations.`,
    );
    return lines.join('\n') + '\n';
  }
  if (previous.version === current.version) {
    lines.push(
      `None in this range. The contract stays at ${current.version}: ${current.operations.length} operations.`,
    );
    return lines.join('\n') + '\n';
  }
  const before = new Set(previous.operations);
  const after = new Set(current.operations);
  const added = current.operations.filter((op) => !before.has(op));
  const removed = previous.operations.filter((op) => !after.has(op));
  lines.push(
    `The contract moved from ${previous.version} to ${current.version} (${previous.operations.length} → ${current.operations.length} operations). Read the API reference's versioning section before upgrading a pinned client.`,
    '',
  );
  lines.push(
    ...bulletList('Added operations', added),
    ...bulletList('Removed operations', removed),
  );
  const entry = changelogEntry(changelog, current.version);
  lines.push(
    '### Changelog',
    '',
    entry === ''
      ? `${current.version} carries no changelog entry in \`api-contract.ts\`.`
      : entry,
  );
  return lines.join('\n') + '\n';
}

function bulletList(title: string, operations: string[]): string[] {
  if (operations.length === 0) return [`${title}: none.`, ''];
  return [`${title}:`, ...operations.map((op) => `- \`${op}\``), ''];
}

/** Reads a JSON file; a missing or unreadable one is `null` when `optional`. */
function readJson(path: string | undefined, optional: boolean): Json | null {
  if (path === undefined) {
    if (optional) return null;
    throw new Error('a required file path is missing');
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Json;
  } catch (error) {
    if (optional) {
      console.warn(
        `[contract-notes] ${path} is unreadable, treated as absent`,
        error,
      );
      return null;
    }
    throw error;
  }
}

function snapshot(fingerprint: Json, openapi: Json): ContractSnapshot {
  return {
    version: String(fingerprint.version),
    operations: listOperations(openapi),
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      'previous-tag': { type: 'string' },
      'previous-fingerprint': { type: 'string' },
      'previous-openapi': { type: 'string' },
      'current-fingerprint': { type: 'string' },
      'current-openapi': { type: 'string' },
      changelog: { type: 'string' },
      out: { type: 'string' },
    },
  });
  const previousFingerprint = readJson(values['previous-fingerprint'], true);
  const previousOpenapi = readJson(values['previous-openapi'], true);
  const previous =
    previousFingerprint !== null && previousOpenapi !== null
      ? snapshot(previousFingerprint, previousOpenapi)
      : null;
  const currentFingerprint = readJson(values['current-fingerprint'], false);
  const currentOpenapi = readJson(values['current-openapi'], false);
  if (currentFingerprint === null || currentOpenapi === null) {
    throw new Error(
      'the current fingerprint and openapi document are required',
    );
  }
  if (values.changelog === undefined) {
    throw new Error('--changelog is required');
  }
  const section = contractChangesSection({
    previous,
    previousTag: values['previous-tag'] ?? '(unknown)',
    current: snapshot(currentFingerprint, currentOpenapi),
    changelog: readFileSync(values.changelog, 'utf8'),
  });
  if (values.out !== undefined) {
    writeFileSync(values.out, section);
  }
  process.stdout.write(section);
}

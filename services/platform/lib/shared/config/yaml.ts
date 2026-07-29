/**
 * The one safe YAML loader every config domain shares — Layer A (V8-safe).
 *
 * Tale's config constitution is YAML-first with JSON accepted everywhere:
 * JSON is valid YAML, so every `.yml` reader takes both. All config-domain
 * parsing funnels through this module so the security posture is defined
 * exactly once:
 *
 * - YAML 1.2 core schema only — no `!!js/*` constructors and no custom
 *   tags. `resolveKnownTags` is off so explicitly tagged `!!timestamp` /
 *   `!!binary` values cannot smuggle `Date`/`Uint8Array` instances past
 *   the Zod schemas; everything this module returns is plain JSON-shaped
 *   data (mappings, sequences, strings, numbers, booleans, null).
 * - Alias expansion is capped to defeat billion-laughs anchor bombs.
 * - Documents are size-capped (default 256 KiB) before the parser runs.
 * - Exactly one document per file, and the root must be a mapping unless
 *   the caller opts into an array root.
 *
 * Failures come back as one-line operator-facing messages carrying line and
 * column wherever the parser provides them. Zod schemas in
 * `lib/shared/schemas/` remain the source of truth for each domain's shape;
 * this module only gets text safely into `unknown` data.
 *
 * Layer A rules apply: importable from V8 Convex code, node actions, Bun
 * scripts, vitest, and the browser. NO `node:*`, NO `convex/_generated`,
 * NO `'use node'`.
 */

import { isMap, isSeq, LineCounter, parseDocument, stringify } from 'yaml';

/** Default document size cap: 256 KiB of UTF-8 text. */
export const DEFAULT_MAX_YAML_BYTES = 256 * 1024;

/**
 * Total alias-expansion budget per document (an alias to a collection counts
 * as the collection's size). A handful of shared-defaults anchors stays far
 * below it; a billion-laughs bomb exhausts it immediately.
 */
const MAX_ALIAS_COUNT = 100;

export interface ParseYamlOptions {
  /**
   * Reject documents whose UTF-8 size exceeds this many bytes.
   * Defaults to {@link DEFAULT_MAX_YAML_BYTES}.
   */
  readonly maxBytes?: number;
  /**
   * Accept a sequence (array) root in addition to a mapping root. Off by
   * default: config files are mappings unless a domain says otherwise.
   */
  readonly allowArrayRoot?: boolean;
}

/**
 * Discriminated parse outcome. The `error` string is a one-line
 * operator-facing message (with line/column where the parser provides
 * them) — safe to surface verbatim in validation reports and admin UIs.
 * Domains that validate further (Zod) can reuse the shape for their own
 * typed results.
 */
export type ParseResult<T = unknown> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string };

function fail(error: string): ParseResult {
  return { ok: false, error };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const kib = bytes / 1024;
  return `${Number.isInteger(kib) ? kib : kib.toFixed(1)} KiB`;
}

function positionAt(lineCounter: LineCounter, offset: number): string {
  const { line, col } = lineCounter.linePos(offset);
  return `line ${line}, column ${col}`;
}

/**
 * Parse one YAML (or JSON) document into plain data, without validating its
 * shape — that is the caller's Zod schema's job. Never throws for bad
 * input; returns `{ok: false, error}` with an actionable one-line message.
 */
export function parseYaml(
  text: string,
  options: ParseYamlOptions = {},
): ParseResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_YAML_BYTES;
  // TextEncoder (not Buffer) so the byte cap works in the browser and in
  // Convex's V8 runtime, matching how file sizes look on disk.
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > maxBytes) {
    return fail(
      `YAML document is too large: ${formatBytes(byteLength)} exceeds the ${formatBytes(maxBytes)} limit`,
    );
  }

  const lineCounter = new LineCounter();
  const doc = parseDocument(text, {
    schema: 'core',
    // Keep even the YAML 1.1 convenience tags (!!timestamp, !!binary, …)
    // unresolved so no non-JSON value type can leave this module.
    resolveKnownTags: false,
    uniqueKeys: true,
    // One-line messages are composed below from the raw message plus the
    // line counter; pretty errors would append a multi-line code frame.
    prettyErrors: false,
    lineCounter,
  });

  const [firstError] = doc.errors;
  if (firstError) {
    const position = positionAt(lineCounter, firstError.pos[0]);
    if (firstError.code === 'MULTIPLE_DOCS') {
      return fail(
        `YAML must contain a single document, but a second document starts at ${position} — remove the "---" separator`,
      );
    }
    return fail(`YAML parse error at ${position}: ${firstError.message}`);
  }

  // The core schema reports unknown tags (!!js/function, !custom, …) as
  // warnings and would otherwise pass their raw scalar value through;
  // for config files an unsupported tag is an error.
  const [firstWarning] = doc.warnings;
  if (firstWarning) {
    return fail(
      `Unsupported YAML at ${positionAt(lineCounter, firstWarning.pos[0])}: ${firstWarning.message} — only core-schema values (mappings, sequences, strings, numbers, booleans, null) are supported`,
    );
  }

  const root = doc.contents;
  if (root == null) {
    return fail(
      'YAML document is empty — expected a mapping of configuration keys',
    );
  }
  const rootAllowed =
    isMap(root) || (options.allowArrayRoot === true && isSeq(root));
  if (!rootAllowed) {
    const wanted = options.allowArrayRoot
      ? 'a mapping (key: value pairs) or a sequence'
      : 'a mapping (key: value pairs)';
    const found = isSeq(root) ? 'a sequence' : 'a single scalar value';
    return fail(`YAML root must be ${wanted}, not ${found}`);
  }

  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // The yaml package throws once a document spends more than
    // maxAliasCount node expansions on aliases.
    if (message.includes('alias count')) {
      return fail(
        `YAML uses too many alias expansions (limit ${MAX_ALIAS_COUNT}) — anchor bombs are rejected; simplify the document's anchors`,
      );
    }
    return fail(`YAML conversion failed: ${message}`);
  }
  return { ok: true, data };
}

/**
 * Like {@link parseYaml}, but throws an `Error` carrying the same
 * operator-facing message. For scripts, tests, and call sites where a bad
 * document is exceptional rather than a reportable validation outcome.
 */
export function parseYamlOrThrow(
  text: string,
  options: ParseYamlOptions = {},
): unknown {
  const result = parseYaml(text, options);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

/**
 * Serialize plain JSON-shaped data to the canonical on-disk YAML form every
 * config writer shares: YAML 1.2 core schema, 2-space indent, no anchors or
 * tags, trailing newline. The output round-trips through {@link parseYaml}
 * losslessly (same library, same schema), so what a writer persists is
 * exactly what every reader — and the Zod schema behind it — gets back.
 */
export function stringifyYaml(data: unknown): string {
  return stringify(data, {
    schema: 'core',
    indent: 2,
    // Serialize repeated object references as independent copies; emitting
    // `&anchor`/`*alias` pairs would make the on-disk form depend on object
    // identity inside the writer, which no schema can see.
    aliasDuplicateObjects: false,
  });
}

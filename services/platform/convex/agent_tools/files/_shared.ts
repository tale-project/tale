/**
 * Shared validators for the file_* / run_code tools.
 *
 * Path validation mirrors the rules the older `agent_tools/artifacts/shared.ts`
 * applied to artifact files — POSIX-relative, NFC-normalized, no `..`,
 * restricted character set. Kept self-contained here so the new tool path
 * doesn't depend on the artifact module (which is being deprecated).
 */

import type { ZodIssue } from 'zod/v4';

export class InvalidFilePathError extends Error {
  readonly code:
    | 'path_empty'
    | 'path_too_long'
    | 'path_absolute'
    | 'path_traversal'
    | 'path_invalid_chars'
    | 'path_segment_invalid';
  constructor(code: InvalidFilePathError['code'], message: string) {
    super(message);
    this.name = 'InvalidFilePathError';
    this.code = code;
  }
}

const PATH_MAX = 200;
const ALLOWED_CHAR = /^[a-zA-Z0-9._\-/]+$/;

/**
 * Validate + normalize a file path. Throws InvalidFilePathError on rejection.
 * Returns the normalized form (NFC, collapsed slashes, no leading `./`).
 */
export function validatePath(raw: string): string {
  if (typeof raw !== 'string') {
    throw new InvalidFilePathError('path_empty', 'path must be a string');
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new InvalidFilePathError('path_empty', 'path must not be empty');
  }
  if (trimmed.length > PATH_MAX) {
    throw new InvalidFilePathError(
      'path_too_long',
      `path exceeds ${PATH_MAX} chars`,
    );
  }
  if (trimmed.startsWith('/')) {
    throw new InvalidFilePathError(
      'path_absolute',
      'path must be relative — no leading slash',
    );
  }
  if (!ALLOWED_CHAR.test(trimmed)) {
    throw new InvalidFilePathError(
      'path_invalid_chars',
      'path may only contain letters, digits, dot, hyphen, underscore, and slash',
    );
  }
  const normalized = trimmed.normalize('NFC').replace(/\/+/g, '/');
  const segments = normalized.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new InvalidFilePathError(
        'path_traversal',
        'path may not contain empty / "." / ".." segments',
      );
    }
  }
  return normalized;
}

/**
 * SHA-256 hex digest of file bytes (Web Crypto — available in the Convex
 * default runtime). Stored on `threadFiles.sha256` so the run_code harvest
 * recognizes a model-written /user/output file as unchanged instead of
 * re-storing the same bytes under a flipped `run_output` provenance.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer — digest() rejects SharedArrayBuffer-backed
  // views under TS's strict lib types.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', ab);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * MIME inference from path extension. Falls back to `application/octet-stream`
 * for unknown extensions.
 */
export function inferContentType(path: string): string {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = lower.slice(dot + 1);
  switch (ext) {
    case 'html':
    case 'htm':
      return 'text/html; charset=utf-8';
    case 'svg':
      return 'image/svg+xml';
    case 'md':
    case 'markdown':
    case 'mmd':
    case 'mermaid':
      return 'text/markdown; charset=utf-8';
    case 'json':
      return 'application/json; charset=utf-8';
    case 'yaml':
    case 'yml':
      return 'application/yaml; charset=utf-8';
    case 'toml':
      return 'application/toml; charset=utf-8';
    case 'py':
    case 'pyi':
    case 'pyw':
    case 'js':
    case 'cjs':
    case 'mjs':
    case 'ts':
    case 'tsx':
    case 'jsx':
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'css':
    case 'txt':
    case 'log':
      return 'text/plain; charset=utf-8';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'pdf':
      return 'application/pdf';
    case 'csv':
      return 'text/csv; charset=utf-8';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'zip':
      return 'application/zip';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Per-file runtime dispatcher. Maps a path's extension to the sandbox
 * runtime that should execute it. Returns `null` for any extension the
 * sandbox doesn't host an interpreter for.
 *
 * `.cjs` / `.mjs` resolve to `node` (Node treats them as commonjs / esm
 * respectively — the entrypoint just runs `node <path>` and Node picks
 * the right module system). `.sh` resolves to `bash` (the runtime image
 * apt-installs bash; entrypoint runs `exec bash <path>`).
 */
export function inferStepLanguage(
  path: string,
): 'python' | 'node' | 'bash' | null {
  const match = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = match ? match[1] : undefined;
  if (ext === 'py') return 'python';
  if (ext === 'js' || ext === 'cjs' || ext === 'mjs') return 'node';
  if (ext === 'sh') return 'bash';
  return null;
}

/**
 * Per-bucket package spec refinement. Mirrors the artifact-side validator —
 * rejects empty strings, version-only specs, and prefix tokens (`python:` /
 * `node:`) that callers occasionally include by accident.
 */
export function refinePackagesObject(
  val: { python?: string[]; node?: string[] } | undefined,
  addIssue: (issue: {
    code: 'custom';
    path: (string | number)[];
    message: string;
  }) => void,
): void {
  if (val === undefined) return;
  const buckets: Array<['python' | 'node', string[]]> = [];
  if (val.python !== undefined) buckets.push(['python', val.python]);
  if (val.node !== undefined) buckets.push(['node', val.node]);
  for (const [bucket, specs] of buckets) {
    for (let i = 0; i < specs.length; i += 1) {
      const spec = specs[i];
      if (typeof spec !== 'string' || spec.trim().length === 0) {
        addIssue({
          code: 'custom',
          path: [bucket, i],
          message: `${bucket}[${i}] must be a non-empty string`,
        });
        continue;
      }
      if (spec.startsWith('python:') || spec.startsWith('node:')) {
        addIssue({
          code: 'custom',
          path: [bucket, i],
          message: `${bucket}[${i}] should not include a runtime prefix; declare it in the appropriate bucket directly`,
        });
      }
    }
  }
}

/**
 * Extract the base package name from a pip/npm spec for allowlist matching.
 *   `python-pptx==1.0.2` → `python-pptx`
 *   `pypdf>=5.1,<6`     → `pypdf`
 *   `@scope/pkg@1.2.3`  → `@scope/pkg`
 */
export function packageBaseName(spec: string): string {
  const trimmed = spec.trim();
  if (trimmed.length === 0) return '';
  // npm scoped: @scope/name[@version]
  if (trimmed.startsWith('@')) {
    const at = trimmed.indexOf('@', 1);
    return at === -1 ? trimmed : trimmed.slice(0, at);
  }
  // Strip first occurrence of any version delimiter.
  const delim = trimmed.search(/[<>=!~ \t]/);
  return delim === -1 ? trimmed : trimmed.slice(0, delim);
}

/** Convert a `_shared.ts` zod refinement helper signature into the form
 *  consumed by zod's `.superRefine(val, ctx)` callback. */
export function makeZodPackagesRefiner(): (
  val: { python?: string[]; node?: string[] } | undefined,
  ctx: {
    addIssue: (issue: {
      code: 'custom';
      path: (string | number)[];
      message: string;
    }) => void;
  },
) => void {
  return (val, ctx) => refinePackagesObject(val, ctx.addIssue);
}

export type _ZodIssueShape = ZodIssue;

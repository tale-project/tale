import { z } from 'zod/v4';

export const artifactTypeEnum = z.enum([
  'html',
  'svg',
  'markdown',
  'mermaid',
  'code',
  // Canonical runnable type. Source code that executes in the server
  // sandbox; per-file runtime is inferred from extension (`.py` →
  // python3, `.js`/`.cjs`/`.mjs` → node) so a single artifact can mix
  // Python and Node files in one project. The canvas-runnable-code-
  // renderer subscribes to the row's `run*` fields to show live
  // progress + the final output file chips.
  'script_runnable',
  // @deprecated — legacy single-runtime literals. Kept here so existing
  // artifact rows continue to validate (per
  // [feedback_deprecate_dont_delete_schema_fields]). New artifact_create
  // calls land at `script_runnable`; old rows route through the same
  // polyglot pipeline with their single-runtime file set.
  'python_runnable',
  'node_runnable',
]);

export type ArtifactType = z.infer<typeof artifactTypeEnum>;

const RUNNABLE_TYPES: ReadonlySet<string> = new Set<ArtifactType>([
  'script_runnable',
  'python_runnable',
  'node_runnable',
]);

export function isValidArtifactType(value: string): value is ArtifactType {
  return (
    value === 'html' ||
    value === 'svg' ||
    value === 'markdown' ||
    value === 'mermaid' ||
    value === 'code' ||
    value === 'script_runnable' ||
    value === 'python_runnable' ||
    value === 'node_runnable'
  );
}

export function isRunnableArtifactType(value: string): boolean {
  return RUNNABLE_TYPES.has(value);
}

/**
 * Legacy helper: returns the single runtime of a legacy
 * `python_runnable` / `node_runnable` row. Returns `null` for
 * `script_runnable` (polyglot — runtime is per-file, not per-artifact).
 * Used only by code paths that still want to short-circuit on
 * "this is a pure-Python or pure-Node artifact". For dispatch, prefer
 * {@link inferStepLanguage} which works for all three types.
 */
export function runnableLanguage(type: ArtifactType): 'python' | 'node' | null {
  if (type === 'python_runnable') return 'python';
  if (type === 'node_runnable') return 'node';
  return null;
}

/**
 * Per-file runtime dispatcher. Maps a path's extension to the sandbox
 * runtime that should execute it. Returns `null` for any extension the
 * sandbox doesn't host an interpreter for (defer to caller to surface
 * INPUT_REJECTED).
 *
 * `.cjs` / `.mjs` are accepted because Node treats them as commonjs /
 * esm respectively — the entrypoint just runs `node <path>` and Node
 * resolves the module system itself.
 */
export function inferStepLanguage(path: string): 'python' | 'node' | null {
  const match = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = match ? match[1] : undefined;
  if (ext === 'py') return 'python';
  if (ext === 'js' || ext === 'cjs' || ext === 'mjs') return 'node';
  return null;
}

/**
 * Collect the set of sandbox runtimes needed to execute the given file
 * paths. Empty set if every path has an unknown extension (caller should
 * reject the request before reaching the spawner).
 */
export function runtimesForFiles(
  paths: readonly string[],
): Set<'python' | 'node'> {
  const out = new Set<'python' | 'node'>();
  for (const p of paths) {
    const lang = inferStepLanguage(p);
    if (lang !== null) out.add(lang);
  }
  return out;
}

/**
 * Split a flat list of package specs into python / node buckets.
 *
 * Agents sometimes send a mixed flat list and tag the language with a
 * `python:` / `pip:` / `node:` / `npm:` prefix instead of using the
 * grouped `{python: [], node: []}` form. We accept that — strip the
 * prefix and route to the matching bucket. Bare (un-prefixed) specs go
 * to the `defaultLang` bucket; if `defaultLang` is `null` they default
 * to python (the scientific-stack convention — npm specs are far more
 * likely to be explicitly tagged than pip specs).
 *
 * This is purely a defensive parser — the canonical input shape is
 * still the grouped `{python, node}` object, and we document that in
 * every tool description.
 *
 * Examples:
 *   classifyPackages(['python:markitdown[pptx]', 'pptxgenjs'], 'node')
 *     → { python: ['markitdown[pptx]'], node: ['pptxgenjs'] }
 *   classifyPackages(['numpy', 'pandas'], 'python')
 *     → { python: ['numpy', 'pandas'], node: [] }
 *   classifyPackages(['lodash'], 'node')
 *     → { python: [], node: ['lodash'] }
 */
const PACKAGE_LANG_PREFIX_RE = /^(python|pip|node|npm):(.+)$/i;
// Pip extras syntax: `pkg[extra]` / `pkg[a,b]`. npm package names
// disallow `[` and `]` entirely, so a `[` anywhere in the spec is an
// unambiguous pip signal — and saves an agent that sent a mixed flat
// list from shipping `markitdown[pptx]` to `npm install` (which would
// fail with EINVALIDTAGNAME).
const PIP_EXTRAS_RE = /\[/;
// npm scoped package: `@scope/name(@version)?`. Pip's own `@` syntax
// for direct URLs (`pkg @ url`) requires whitespace, so a bare-leading
// `@scope/` cannot match pip.
const NPM_SCOPED_RE = /^@[A-Za-z0-9][^@/\s]*\//;

/**
 * Heuristic spec sniff. Returns the language the spec is unambiguously
 * for, or `null` when the shape is generic enough to need a fallback
 * (a bare `numpy` or `lodash` looks the same on both sides).
 */
function detectLangSignal(spec: string): 'python' | 'node' | null {
  if (PIP_EXTRAS_RE.test(spec)) return 'python';
  if (NPM_SCOPED_RE.test(spec)) return 'node';
  return null;
}

/**
 * Return an error string when `spec` is unambiguously NOT a pip spec —
 * meaning its syntax means something different in npm and would either
 * silently mis-install OR error obscurely if forwarded to `uv pip`.
 * Returns `null` for canonical pip specs and generic-enough names that
 * are valid on both sides.
 *
 * Detects:
 *  - npm version pin `pkg@1.2.3` (pip's direct-URL form `pkg @ url`
 *    requires whitespace around `@`, so a bare `pkg@digit` is
 *    unambiguous npm)
 *  - npm scoped package `@scope/name`
 *  - npm range operators `^1.0.0` / `~1.0` at the very start (pip uses
 *    `==` / `~=` / no operator)
 *
 * Wired into the Zod `packages` refine of the three artifact tools so
 * the LLM gets a clear "move this to packages.node instead" error at
 * input parse time, before the sandbox round-trip.
 */
const NPM_VERSION_PIN_RE = /^[A-Za-z0-9._-]+@[\d^~v]/;
const NPM_SCOPE_RE = /^@[A-Za-z0-9]/;
const NPM_RANGE_RE = /^[\^~]\d/;

export function detectPythonSpecError(spec: string): string | null {
  const trimmed = spec.trim();
  if (NPM_VERSION_PIN_RE.test(trimmed)) {
    return `"${trimmed}" looks like an npm version pin (\`pkg@version\` syntax) — move it to packages.node instead. Pip uses \`pkg==version\` for pins.`;
  }
  if (NPM_SCOPE_RE.test(trimmed)) {
    return `"${trimmed}" starts with an npm scope (\`@scope/...\`) — move it to packages.node instead.`;
  }
  if (NPM_RANGE_RE.test(trimmed)) {
    return `"${trimmed}" looks like an npm range operator (\`^x.y.z\` / \`~x.y.z\`) — move it to packages.node instead.`;
  }
  return null;
}

/**
 * Run {@link detectPythonSpecError} / {@link detectNodeSpecError}
 * across both buckets and call `addIssue` for each bad spec. Shared by
 * the three artifact tools that accept a `packages` object so the
 * error messages stay identical.
 *
 * Generic over the Zod refinement context's `addIssue` shape (Zod v4
 * exposes it as `RefinementCtx['addIssue']`) — typing it as a plain
 * function lets the call sites pass `ctx` from either `.superRefine`
 * or `.refine` without depending on Zod internals.
 */
type AddIssue = (issue: {
  code: 'custom';
  path: (string | number)[];
  message: string;
}) => void;

export function refinePackagesObject(
  packages: { python?: string[]; node?: string[] } | undefined,
  addIssue: AddIssue,
): void {
  if (packages === undefined) return;
  for (let i = 0; i < (packages.python ?? []).length; i += 1) {
    const spec = packages.python?.[i];
    if (spec === undefined) continue;
    const err = detectPythonSpecError(spec);
    if (err !== null) {
      addIssue({ code: 'custom', path: ['python', i], message: err });
    }
  }
  for (let i = 0; i < (packages.node ?? []).length; i += 1) {
    const spec = packages.node?.[i];
    if (spec === undefined) continue;
    const err = detectNodeSpecError(spec);
    if (err !== null) {
      addIssue({ code: 'custom', path: ['node', i], message: err });
    }
  }
}

/**
 * Mirror of {@link detectPythonSpecError} for the `packages.node`
 * bucket: returns an error string when `spec` is unambiguously a pip
 * spec.
 *
 * Detects:
 *  - pip extras `pkg[extra]` / `pkg[a,b]` — npm package names disallow
 *    `[` and `]`
 *  - pip PEP 440 operators `==` / `~=` / `!=` / `===`
 *  - pip direct-URL form `pkg @ url` (whitespace around `@`)
 */
const PIP_EXTRAS_BRACKET_RE = /\[/;
const PIP_PEP440_OP_RE = /===|==|~=|!=/;
const PIP_DIRECT_URL_RE = /\s@\s/;

export function detectNodeSpecError(spec: string): string | null {
  const trimmed = spec.trim();
  if (PIP_EXTRAS_BRACKET_RE.test(trimmed)) {
    return `"${trimmed}" uses pip extras syntax (\`pkg[extra]\`) — npm packages cannot contain \`[\`. Move it to packages.python instead.`;
  }
  if (PIP_PEP440_OP_RE.test(trimmed)) {
    return `"${trimmed}" uses a pip PEP 440 version operator (\`==\` / \`~=\` / \`!=\`) — npm uses \`@version\` / \`^\` / \`~\`. Move it to packages.python instead, or rewrite as e.g. \`pkg@1.2.3\` if it really is an npm package.`;
  }
  if (PIP_DIRECT_URL_RE.test(trimmed)) {
    return `"${trimmed}" looks like pip's direct-URL form (\`pkg @ url\` with whitespace) — move it to packages.python instead.`;
  }
  return null;
}

export function classifyPackages(
  specs: readonly string[],
  defaultLang: 'python' | 'node' | null,
): { python: string[]; node: string[] } {
  const python: string[] = [];
  const node: string[] = [];
  for (const raw of specs) {
    const spec = raw.trim();
    if (spec.length === 0) continue;
    const prefixMatch = spec.match(PACKAGE_LANG_PREFIX_RE);
    if (prefixMatch) {
      const tag = prefixMatch[1]?.toLowerCase();
      const stripped = prefixMatch[2] ?? '';
      if (stripped.length === 0) continue;
      if (tag === 'python' || tag === 'pip') python.push(stripped);
      else node.push(stripped); // 'node' or 'npm'
      continue;
    }
    const signal = detectLangSignal(spec);
    if (signal === 'python') {
      python.push(spec);
    } else if (signal === 'node') {
      node.push(spec);
    } else if (defaultLang === 'node') {
      node.push(spec);
    } else {
      python.push(spec);
    }
  }
  return { python, node };
}

/**
 * Types where the entry file is useless empty — the LLM must supply content
 * at `artifact_create` time. For these, the create tool's Zod schema marks
 * `content` as required.
 */
const CONTENT_REQUIRED_TYPES: ReadonlySet<ArtifactType> = new Set([
  'html',
  'svg',
  'mermaid',
  'script_runnable',
  'python_runnable',
  'node_runnable',
]);

export function isContentRequiredAtCreate(type: ArtifactType): boolean {
  return CONTENT_REQUIRED_TYPES.has(type);
}

// =============================================================================
// Title normalization (idempotency key)
// =============================================================================

/**
 * Canonical form used for idempotency comparisons in `artifact_create`.
 * NFC-normalized, trimmed, internal whitespace collapsed, case-folded.
 * The ORIGINAL casing/spacing is what we store as the title; this value
 * is the comparison key only.
 */
export function normalizeTitleForCompare(title: string): string {
  return title
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en');
}

/**
 * Storage form: NFC + trim + collapse whitespace, but preserve case.
 * What we write into `artifacts.title`.
 */
export function normalizeTitleForStorage(title: string): string {
  return title.normalize('NFC').trim().replace(/\s+/g, ' ');
}

// =============================================================================
// Default entry-file resolution
// =============================================================================

const LANGUAGE_TO_EXT: Record<string, string> = {
  ts: 'ts',
  typescript: 'ts',
  tsx: 'tsx',
  js: 'js',
  javascript: 'js',
  jsx: 'jsx',
  py: 'py',
  python: 'py',
  rb: 'rb',
  ruby: 'rb',
  go: 'go',
  rs: 'rs',
  rust: 'rs',
  java: 'java',
  kotlin: 'kt',
  kt: 'kt',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  cs: 'cs',
  csharp: 'cs',
  php: 'php',
  sh: 'sh',
  bash: 'sh',
  zsh: 'sh',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yml',
  json: 'json',
  toml: 'toml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  md: 'md',
  markdown: 'md',
};

export function defaultExtensionForLanguage(
  language: string | undefined,
): string {
  if (!language) return 'txt';
  const key = language.toLocaleLowerCase('en');
  return LANGUAGE_TO_EXT[key] ?? 'txt';
}

/**
 * Default entry-file path per artifact type. The LLM may override on
 * `artifact_create` via the optional `entryFile` parameter; if no override,
 * this default seeds the project's entry file.
 */
export function defaultEntryFileFor(
  type: ArtifactType,
  language?: string,
): string {
  switch (type) {
    case 'html':
      return 'index.html';
    case 'svg':
      return 'image.svg';
    case 'mermaid':
      return 'diagram.mmd';
    case 'markdown':
      return 'README.md';
    case 'code':
      return `main.${defaultExtensionForLanguage(language)}`;
    case 'script_runnable': {
      // Polyglot type — entry file extension follows the optional
      // `language` hint when supplied, else defaults to Python (the more
      // common starting point for our agents). The hint is the same one
      // used for static `code` artifacts so the LLM can keep one mental
      // model for "what extension am I getting".
      const hint = (language ?? '').toLocaleLowerCase('en');
      if (
        hint === 'js' ||
        hint === 'javascript' ||
        hint === 'node' ||
        hint === 'mjs' ||
        hint === 'cjs'
      ) {
        return 'main.js';
      }
      return 'main.py';
    }
    case 'python_runnable':
      return 'main.py';
    case 'node_runnable':
      return 'main.js';
    default: {
      // Exhaustive switch — TS narrows `type` to `never` here. Defensive
      // return so oxlint's `consistent-return` rule is satisfied.
      const _exhaustive: never = type;
      void _exhaustive;
      return 'main.txt';
    }
  }
}

// =============================================================================
// Path validation (16-rule pipeline; see plan §Path Validation)
// =============================================================================

const MAX_PATH_LENGTH = 200;
export const MAX_FILES_PER_ARTIFACT = 50;

// BiDi overrides + LRM/RLM. U+202A-U+202E, U+2066-U+2069, U+200E-U+200F.
// Explicit \u escapes so the source has no invisible characters and
// oxlint's `no-misleading-character-class` rule sees an unambiguous class.
const BIDI_OVERRIDES = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/u;
// Zero-width chars + BOM. ZWSP (200B), ZWNJ (200C), ZWJ (200D), BOM (FEFF).
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/u;
const CONTROL_CHARS = /[\x00-\x1F\x7F]/;
const URL_ENCODED_TRAVERSAL = /%(2e|2E|2f|5c)/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const ASCII_COMPONENT_ALLOWLIST = /^[A-Za-z0-9._-]+$/;

export type PathValidationCode =
  | 'EMPTY'
  | 'TOO_LONG'
  | 'CONTROL_CHARS'
  | 'ZERO_WIDTH'
  | 'BIDI_OVERRIDE'
  | 'ABSOLUTE'
  | 'BACKSLASH'
  | 'URL_ENCODED_TRAVERSAL'
  | 'TRAVERSAL'
  | 'EMPTY_SEGMENT'
  | 'MULTI_SLASH'
  | 'LEADING_DOT_SLASH'
  | 'TRAILING_SLASH'
  | 'HIDDEN_DOTFILE'
  | 'DISALLOWED_CHAR'
  | 'WINDOWS_RESERVED';

export interface PathValidationError {
  code: PathValidationCode;
  path: string;
  message: string;
}

export class InvalidArtifactPathError extends Error {
  readonly code: PathValidationCode;
  readonly path: string;
  constructor(error: PathValidationError) {
    super(error.message);
    this.name = 'InvalidArtifactPathError';
    this.code = error.code;
    this.path = error.path;
  }
}

/**
 * Narrow a caught error to its structured code + message for return to
 * the LLM. Tool catch blocks used to flatten every error into
 * `{success: false, message}` with NO code field, even though the
 * underlying `ConvexError`/`InvalidArtifactPathError` already carries a
 * stable code. Returning the code lets the LLM react programmatically
 * (e.g. retry with smaller content on `too_large`, pick a different
 * path on `invalid_path`) instead of string-sniffing the message
 * (audit follow-up F8).
 */
export function extractToolErrorShape(err: unknown): {
  code?: string;
  message: string;
} {
  if (err instanceof InvalidArtifactPathError) {
    return {
      // Surface a stable kebab-case code so the LLM can dispatch on it
      // alongside the mutation's discriminated-union codes (which use
      // snake_case). All path-validation failures collapse to
      // `invalid_path` — the more granular `PathValidationCode` is
      // included in the message text for human triage.
      code: 'invalid_path',
      message: `${err.message} (${err.code})`,
    };
  }
  // ConvexError carries its structured payload on `.data`. We can't
  // rely on `instanceof ConvexError` reaching across the action/mutation
  // bundle boundary cleanly, so shape-narrow on the `.data` field.
  if (err instanceof Error) {
    // Type-cast the error object to a partial structural shape rather
    // than `any`. `data` is whatever the throwing site passed to
    // `new ConvexError({...})`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const data = (err as { data?: unknown }).data;
    if (
      typeof data === 'object' &&
      data !== null &&
      'code' in data &&
      typeof (data as { code: unknown }).code === 'string'
    ) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const dCode = (data as { code: string }).code;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const dMessage = (data as { message?: unknown }).message;
      return {
        code: dCode,
        message:
          typeof dMessage === 'string' && dMessage.length > 0
            ? dMessage
            : err.message,
      };
    }
    return { message: err.message };
  }
  return { message: String(err) };
}

/**
 * Validate a file path for safe storage and sandbox-write. Run at every
 * mutation boundary that accepts a path. Throws `InvalidArtifactPathError`
 * with a structured code on failure. On success, returns the NFC-normalized
 * form — callers MUST store the returned value, not the input.
 *
 * Pipeline order matters: normalization first (so subsequent checks see
 * canonical bytes), then byte-level rejections, then structural.
 */
export function validatePath(input: string): string {
  if (input.length === 0) {
    throw new InvalidArtifactPathError({
      code: 'EMPTY',
      path: input,
      message: 'Path is empty.',
    });
  }
  const path = input.normalize('NFC');
  if (path.length > MAX_PATH_LENGTH) {
    throw new InvalidArtifactPathError({
      code: 'TOO_LONG',
      path,
      message: `Path is ${path.length} chars; max ${MAX_PATH_LENGTH}.`,
    });
  }
  if (CONTROL_CHARS.test(path)) {
    throw new InvalidArtifactPathError({
      code: 'CONTROL_CHARS',
      path,
      message: 'Path contains control characters (incl. NUL).',
    });
  }
  if (ZERO_WIDTH.test(path)) {
    throw new InvalidArtifactPathError({
      code: 'ZERO_WIDTH',
      path,
      message: 'Path contains zero-width or BOM characters.',
    });
  }
  if (BIDI_OVERRIDES.test(path)) {
    throw new InvalidArtifactPathError({
      code: 'BIDI_OVERRIDE',
      path,
      message: 'Path contains bidirectional-text overrides.',
    });
  }
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) {
    throw new InvalidArtifactPathError({
      code: 'ABSOLUTE',
      path,
      message: 'Path must be relative; absolute paths are rejected.',
    });
  }
  if (path.includes('\\')) {
    throw new InvalidArtifactPathError({
      code: 'BACKSLASH',
      path,
      message: 'Path must use forward slashes only.',
    });
  }
  if (URL_ENCODED_TRAVERSAL.test(path)) {
    throw new InvalidArtifactPathError({
      code: 'URL_ENCODED_TRAVERSAL',
      path,
      message: 'Path contains URL-encoded traversal sequences.',
    });
  }
  if (path.startsWith('./')) {
    throw new InvalidArtifactPathError({
      code: 'LEADING_DOT_SLASH',
      path,
      message: 'Path must not start with "./".',
    });
  }
  if (path.endsWith('/')) {
    throw new InvalidArtifactPathError({
      code: 'TRAILING_SLASH',
      path,
      message: 'Path must not end with "/".',
    });
  }
  if (path.includes('//')) {
    throw new InvalidArtifactPathError({
      code: 'MULTI_SLASH',
      path,
      message: 'Path must not contain consecutive slashes.',
    });
  }
  const segments = path.split('/');
  for (const segment of segments) {
    if (segment === '') {
      throw new InvalidArtifactPathError({
        code: 'EMPTY_SEGMENT',
        path,
        message: 'Path contains an empty segment.',
      });
    }
    if (segment === '.' || segment === '..') {
      throw new InvalidArtifactPathError({
        code: 'TRAVERSAL',
        path,
        message: 'Path contains "." or ".." segment.',
      });
    }
    if (segment.startsWith('.')) {
      throw new InvalidArtifactPathError({
        code: 'HIDDEN_DOTFILE',
        path,
        message: `Hidden dotfile segment "${segment}" rejected.`,
      });
    }
    if (!ASCII_COMPONENT_ALLOWLIST.test(segment)) {
      throw new InvalidArtifactPathError({
        code: 'DISALLOWED_CHAR',
        path,
        message: `Path segment "${segment}" contains characters outside [A-Za-z0-9._-].`,
      });
    }
    if (WINDOWS_RESERVED.test(segment)) {
      throw new InvalidArtifactPathError({
        code: 'WINDOWS_RESERVED',
        path,
        message: `Path segment "${segment}" matches a Windows-reserved name.`,
      });
    }
  }
  return path;
}

/**
 * Validate uniqueness of paths within a project (case-insensitive — covers
 * macOS dev hosts where `Main.py` and `main.py` would collide on disk).
 * Returns the first conflicting path, or `null` if all unique.
 */
export function findDuplicatePath(
  files: readonly { readonly path: string }[],
): string | null {
  const seen = new Set<string>();
  for (const f of files) {
    const key = f.path.toLocaleLowerCase('en');
    if (seen.has(key)) return f.path;
    seen.add(key);
  }
  return null;
}

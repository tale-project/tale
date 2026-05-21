// Hand-rolled runtime validator for `POST /v1/execute` request bodies.
//
// The spawner ships ZERO runtime dependencies by design (server.ts is
// Bun-native + node:crypto only), so we can't reach for zod/valibot here.
// This file is the boundary between "an unknown object that came off the
// wire" and the typed `ExecuteRequest` the rest of the pipeline accepts.
//
// Every field is checked against:
//   1. type (string/number/array/object)
//   2. shape constraints (length, alphabet, range)
//
// Audit finding R2-B3: server.ts previously did `parsedUnknown as
// ExecuteRequest` and only spot-checked `executionId`. Each remaining
// field was forwarded into deeper logic (spawn.ts, docker-args.ts) where
// a malformed input would crash with a less useful diagnostic.

import type { ExecuteRequest, Language, SandboxFile } from './types.ts';
import {
  FILE_PATH_SEGMENT_RE,
  ID_ALPHABET_RE,
  MAX_FILES_BYTES,
  MAX_FILES_PER_REQUEST,
  MAX_FILE_PATH_LENGTH,
  ORG_ID_ALPHABET_RE,
  sandboxLanguageLiterals,
} from './wire.ts';

export type ValidateResult =
  | { ok: true; request: ExecuteRequest }
  | { ok: false; error: string };

// Caps mirror what downstream argv builders + the runtime image accept.
// The spawner-side body cap (cfg.maxRequestBodyBytes, default 256 KB)
// is the hard upper bound on string sizes; per-field caps below stay
// inside that and surface as readable error strings instead of cryptic
// downstream throws.
const MAX_PACKAGES = 20;
const MAX_PACKAGE_SPEC = 200;
const MAX_PURPOSE = 200;
const MAX_TIMEOUT_MS = 600_000; // 10 minutes — well above the runtime watchdog
const MAX_CODE_BYTES = 200_000; // 200 KB source; aligns with platform MAX_ARTIFACT_BYTES

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isLanguage(v: unknown): v is Language {
  return (
    typeof v === 'string' &&
    (sandboxLanguageLiterals as readonly string[]).includes(v)
  );
}

export function validateExecuteRequest(raw: unknown): ValidateResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'request body must be a JSON object' };
  }
  const r = raw as Record<string, unknown>;

  if (!isString(r.executionId) || !ID_ALPHABET_RE.test(r.executionId)) {
    return { ok: false, error: 'executionId is missing or malformed' };
  }
  if (
    !isString(r.organizationId) ||
    !ORG_ID_ALPHABET_RE.test(r.organizationId)
  ) {
    return { ok: false, error: 'organizationId is missing or malformed' };
  }
  if (!isLanguage(r.language)) {
    return {
      ok: false,
      error: `language must be one of ${sandboxLanguageLiterals.join(', ')}`,
    };
  }
  if (!isString(r.code)) {
    return { ok: false, error: 'code must be a string' };
  }
  if (Buffer.byteLength(r.code, 'utf8') > MAX_CODE_BYTES) {
    return {
      ok: false,
      error: `code exceeds ${MAX_CODE_BYTES}-byte limit`,
    };
  }

  // packages: optional string[] with length + per-element-length caps.
  let packages: string[] | undefined;
  if (r.packages !== undefined) {
    if (!Array.isArray(r.packages)) {
      return { ok: false, error: 'packages must be an array of strings' };
    }
    if (r.packages.length > MAX_PACKAGES) {
      return {
        ok: false,
        error: `packages exceeds ${MAX_PACKAGES}-item limit`,
      };
    }
    for (const p of r.packages) {
      if (!isString(p)) {
        return { ok: false, error: 'every package entry must be a string' };
      }
      if (p.length > MAX_PACKAGE_SPEC) {
        return {
          ok: false,
          error: `package spec exceeds ${MAX_PACKAGE_SPEC}-char limit`,
        };
      }
    }
    packages = r.packages as string[];
  }

  // timeoutMs: optional positive number, bounded.
  let timeoutMs: number | undefined;
  if (r.timeoutMs !== undefined) {
    if (
      typeof r.timeoutMs !== 'number' ||
      !Number.isFinite(r.timeoutMs) ||
      r.timeoutMs <= 0 ||
      r.timeoutMs > MAX_TIMEOUT_MS
    ) {
      return {
        ok: false,
        error: `timeoutMs must be a positive number ≤ ${MAX_TIMEOUT_MS}`,
      };
    }
    timeoutMs = r.timeoutMs;
  }

  // options: optional object with two optional booleans. We do NOT
  // re-emit the field if it's empty — keeps the wire shape stable.
  let options: ExecuteRequest['options'];
  if (r.options !== undefined) {
    if (
      r.options === null ||
      typeof r.options !== 'object' ||
      Array.isArray(r.options)
    ) {
      return { ok: false, error: 'options must be an object' };
    }
    const opts = r.options as Record<string, unknown>;
    if (opts.allowSdist !== undefined && typeof opts.allowSdist !== 'boolean') {
      return { ok: false, error: 'options.allowSdist must be a boolean' };
    }
    if (
      opts.allowInstallScripts !== undefined &&
      typeof opts.allowInstallScripts !== 'boolean'
    ) {
      return {
        ok: false,
        error: 'options.allowInstallScripts must be a boolean',
      };
    }
    options = {
      ...(opts.allowSdist !== undefined && {
        allowSdist: opts.allowSdist as boolean,
      }),
      ...(opts.allowInstallScripts !== undefined && {
        allowInstallScripts: opts.allowInstallScripts as boolean,
      }),
    };
  }

  // files / entryPath: optional sibling staging. Per-path safety mirrors
  // the platform's `validatePath` rules; spawner-side check is
  // defense-in-depth — never trust the upstream typecheck.
  let files: SandboxFile[] | undefined;
  let entryPath: string | undefined;
  if (r.files !== undefined) {
    const validated = validateFiles(r.files);
    if (!validated.ok) return { ok: false, error: validated.error };
    files = validated.files;
  }
  if (r.entryPath !== undefined) {
    if (!isString(r.entryPath)) {
      return { ok: false, error: 'entryPath must be a string' };
    }
    const safe = isSafeRelativePath(r.entryPath);
    if (!safe.ok) {
      return { ok: false, error: `entryPath: ${safe.error}` };
    }
    entryPath = r.entryPath;
    if (files !== undefined && !files.some((f) => f.path === entryPath)) {
      return {
        ok: false,
        error: `entryPath "${entryPath}" must reference a path in files`,
      };
    }
  }

  // purpose: optional human-readable label, length-capped to defend the
  // audit-row preview from a megabyte-sized "purpose" string.
  // (purpose isn't in ExecuteRequest, but if a future caller ships it the
  // spawn pipeline ignores it; bound here for defense-in-depth.)
  if (r.purpose !== undefined && isString(r.purpose)) {
    if (r.purpose.length > MAX_PURPOSE) {
      return {
        ok: false,
        error: `purpose exceeds ${MAX_PURPOSE}-char limit`,
      };
    }
  }

  return {
    ok: true,
    request: {
      executionId: r.executionId,
      organizationId: r.organizationId,
      language: r.language,
      code: r.code,
      ...(packages !== undefined && { packages }),
      ...(timeoutMs !== undefined && { timeoutMs }),
      ...(options !== undefined && { options }),
      ...(files !== undefined && { files }),
      ...(entryPath !== undefined && { entryPath }),
    },
  };
}

/**
 * Reject relative paths that could escape `/workspace/code/` or step on
 * runtime conventions. Mirrors the subset of platform-side validatePath
 * that matters at the spawner boundary; the platform's full 16-rule
 * pipeline (NFC, BiDi, zero-width, Windows-reserved) runs server-side
 * before any request reaches this code.
 */
function isSafeRelativePath(
  p: string,
): { ok: true } | { ok: false; error: string } {
  if (p.length === 0) return { ok: false, error: 'path is empty' };
  if (p.length > MAX_FILE_PATH_LENGTH) {
    return { ok: false, error: `path exceeds ${MAX_FILE_PATH_LENGTH} chars` };
  }
  if (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)) {
    return { ok: false, error: 'path must be relative' };
  }
  if (p.includes('\\')) {
    return { ok: false, error: 'path must use forward slashes' };
  }
  if (p.startsWith('./')) {
    return { ok: false, error: 'path must not start with "./"' };
  }
  if (p.endsWith('/')) {
    return { ok: false, error: 'path must not end with "/"' };
  }
  if (p.includes('//')) {
    return { ok: false, error: 'path must not contain "//"' };
  }
  // Reject control chars, NUL, and any non-printable byte (defense in
  // depth — platform side already strips these).
  for (let i = 0; i < p.length; i += 1) {
    const c = p.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) {
      return { ok: false, error: 'path contains control characters' };
    }
  }
  const segments = p.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      return { ok: false, error: `path has bad segment "${seg}"` };
    }
    if (seg.startsWith('.')) {
      return { ok: false, error: `hidden dotfile segment "${seg}" rejected` };
    }
    if (!FILE_PATH_SEGMENT_RE.test(seg)) {
      return {
        ok: false,
        error: `path segment "${seg}" has chars outside [A-Za-z0-9._-]`,
      };
    }
  }
  return { ok: true };
}

function validateFiles(
  raw: unknown,
): { ok: true; files: SandboxFile[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'files must be an array' };
  }
  if (raw.length > MAX_FILES_PER_REQUEST) {
    return {
      ok: false,
      error: `files exceeds ${MAX_FILES_PER_REQUEST}-item limit`,
    };
  }
  const seenLower = new Set<string>();
  const out: SandboxFile[] = [];
  let aggregateBytes = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const entry: unknown = raw[i];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: `files[${i}] must be an object` };
    }
    // After the guard above `entry` is `object`; reading string-indexed
    // properties through a typed Record is the canonical wire-shape
    // narrowing pattern used elsewhere in this validator (see `r` at the
    // top of validateExecuteRequest).
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const e = entry as Record<string, unknown>;
    if (!isString(e.path)) {
      return { ok: false, error: `files[${i}].path must be a string` };
    }
    if (!isString(e.content)) {
      return { ok: false, error: `files[${i}].content must be a string` };
    }
    const safe = isSafeRelativePath(e.path);
    if (!safe.ok) {
      return { ok: false, error: `files[${i}].path: ${safe.error}` };
    }
    const lower = e.path.toLowerCase();
    if (seenLower.has(lower)) {
      return {
        ok: false,
        error: `files[${i}].path "${e.path}" duplicates an earlier entry (case-insensitive)`,
      };
    }
    seenLower.add(lower);
    aggregateBytes += Buffer.byteLength(e.content, 'utf8');
    if (aggregateBytes > MAX_FILES_BYTES) {
      return {
        ok: false,
        error: `files aggregate content exceeds ${MAX_FILES_BYTES}-byte limit`,
      };
    }
    out.push({ path: e.path, content: e.content });
  }
  return { ok: true, files: out };
}

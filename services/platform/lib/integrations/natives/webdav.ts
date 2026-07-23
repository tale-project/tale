/**
 * The `webdav` connector's native backends — list, read, write, delete against
 * the ORGANIZATION's own file store, the same tree the platform's `/dav`
 * endpoint serves.
 *
 * These actions speak no HTTP. The files they touch are the platform's own, so
 * reaching them over the network — even our own `/dav` server — would mean
 * minting a second credential, a second authorization path, and a second set
 * of rules about what a path may address. Instead the actions go through the
 * platform's existing document-store seam, injected as {@link WebdavStore}, and
 * keep for themselves only the two things a caller-facing surface must own:
 *
 *  - **which tenant** — always `ctx.organizationId`, never anything the input
 *    said. An action's arguments come from an agent or a workflow author, so an
 *    organization named in the input would be an organization the caller chose.
 *  - **which path** — parsed by {@link parseOrgPath}, which refuses traversal
 *    and control characters before a name reaches the store.
 *
 * Everything else — legal holds, project-scoped files, blob backends, folder
 * cascade — is the store's, which is the same code the DAV server runs. A
 * refusal it raises is surfaced verbatim rather than retried or worked around:
 * held content stays held.
 */

import { z } from 'zod/v4';

import type {
  NativeIntegrationContext,
  NativeIntegrationImpl,
} from '../dispatcher';
import { IntegrationError, type IntegrationErrorCode } from '../errors';
import { formatChildPath, formatOrgPath, parseOrgPath } from './webdav-paths';

const CONNECTOR = 'webdav';

/** Ceiling for one `read`. The contents cross a function boundary and land in
 * an agent's context, so a whole-file read is bounded well below what the
 * store can hold. */
export const MAX_READ_BYTES = 1024 * 1024;

/** Ceiling for one `write`, matching the read ceiling: an action writes a
 * document it composed, not a bulk upload (that is what `/dav` is for). */
export const MAX_WRITE_BYTES = 1024 * 1024;

/** What a file gets when the caller names no type. */
const DEFAULT_CONTENT_TYPE = 'text/plain';

// ------------------------------------------------------------------- the seam

/** One entry directly inside a folder. */
export interface WebdavEntry {
  readonly name: string;
  readonly isDir: boolean;
  /** Bytes for a file; `0` for a folder, which holds none itself. */
  readonly size: number;
}

export interface WebdavFileBytes {
  readonly bytes: Uint8Array;
  /** The stored MIME type, when the store recorded one. */
  readonly contentType: string | null;
}

/**
 * The organization's document store, as these four actions need it.
 *
 * Injected rather than imported: the implementation is a Convex call, and a
 * native that reached for it directly could neither be unit-tested nor reused
 * by a host that stores documents elsewhere. Every method is given the
 * organization explicitly — the store never infers a tenant.
 */
export interface WebdavStore {
  /** Entries directly under a folder. `segments` empty is the org root. */
  list(args: {
    organizationId: string;
    segments: readonly string[];
  }): Promise<readonly WebdavEntry[]>;
  /** A file's bytes. Refuses (`too-large`) above `maxBytes` rather than
   * loading a blob it would only truncate. */
  read(args: {
    organizationId: string;
    segments: readonly string[];
    maxBytes: number;
  }): Promise<WebdavFileBytes>;
  /** Create or overwrite one file. */
  write(args: {
    organizationId: string;
    segments: readonly string[];
    bytes: Uint8Array;
    contentType: string;
  }): Promise<void>;
  /** Delete a file or folder; `false` when nothing was there. */
  remove(args: {
    organizationId: string;
    segments: readonly string[];
  }): Promise<boolean>;
}

/**
 * Why the store refused. A code (not prose) so the action can turn each into
 * the right caller-facing message, and so a policy refusal — a legal hold — is
 * never mistaken for a transient failure worth retrying.
 */
export type WebdavStoreErrorCode =
  /** No file or folder at that path. */
  | 'not-found'
  /** The path names a folder where a file was required. */
  | 'not-a-file'
  /** The path names a file where a folder was required. */
  | 'not-a-folder'
  /** The containing folder does not exist; the store never creates one. */
  | 'parent-missing'
  /** A legal hold covers the content the operation would destroy. */
  | 'legal-hold'
  /** The resource is bigger than the operation's ceiling. */
  | 'too-large';

export class WebdavStoreError extends Error {
  readonly code: WebdavStoreErrorCode;

  constructor(code: WebdavStoreErrorCode, message: string) {
    super(message);
    this.name = 'WebdavStoreError';
    this.code = code;
  }
}

// --------------------------------------------------------------- input shapes

/**
 * The actions re-check their own input. The dispatcher validates it against the
 * connector's JSON Schema first, but a native is trusted platform code acting
 * on org-owned files: it states its own preconditions rather than inheriting
 * whichever caller happened to reach it.
 */
const pathInput = z.object({ path: z.string() });

const writeInput = z.object({
  path: z.string(),
  content: z.string(),
  contentType: z.string().min(1).optional(),
});

// -------------------------------------------------------------------- helpers

function refuse(
  code: IntegrationErrorCode,
  action: string,
  message: string,
  hint?: string,
): IntegrationError {
  return new IntegrationError(code, message, {
    connector: CONNECTOR,
    action,
    ...(hint !== undefined && { hint }),
  });
}

/** Parse the input, or refuse with what was wrong. */
function parseInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
  action: string,
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw refuse(
      'INPUT_INVALID',
      action,
      `webdav.${action} input is not usable: ${parsed.error.issues[0]?.message ?? 'invalid input'}`,
    );
  }
  return parsed.data;
}

/** The addressed segments, or a refusal naming the traversal/character that
 * made the path unusable. */
function segmentsOf(rawPath: string, action: string): readonly string[] {
  const parsed = parseOrgPath(rawPath);
  if (!parsed.ok) {
    throw refuse(
      'INPUT_INVALID',
      action,
      `"${rawPath.slice(0, 120)}" is not a valid path: ${parsed.reason}`,
      'paths are relative to the organization root, e.g. "/reports/q3.md" — they cannot climb above it',
    );
  }
  return parsed.segments;
}

/**
 * Turn a store refusal into the action's own coded refusal. Anything that is
 * not a store refusal is rethrown untouched: an unexpected failure must reach
 * the dispatcher as itself, not disguised as a policy decision.
 */
function translateStoreError(
  error: unknown,
  action: string,
  path: string,
): never {
  if (!(error instanceof WebdavStoreError)) throw error;
  switch (error.code) {
    case 'not-found':
      throw refuse(
        'LIVE_BODY_FAILED',
        action,
        `no file or folder at "${path}"`,
        'list the parent folder to see what is there',
      );
    case 'not-a-file':
      throw refuse(
        'INPUT_INVALID',
        action,
        `"${path}" is a folder, not a file`,
        'use webdav.list to read a folder',
      );
    case 'not-a-folder':
      throw refuse(
        'INPUT_INVALID',
        action,
        `"${path}" is a file, not a folder`,
        'use webdav.read to read a file',
      );
    case 'parent-missing':
      throw refuse(
        'LIVE_BODY_FAILED',
        action,
        `the folder containing "${path}" does not exist`,
        'create the folder first — a write never creates intermediate folders',
      );
    case 'legal-hold':
      throw refuse(
        'LIVE_BODY_FAILED',
        action,
        `"${path}" is under a legal hold and cannot be changed or deleted`,
        'release the hold in Settings → Governance before changing this content',
      );
    case 'too-large':
      throw refuse(
        'LIVE_BODY_FAILED',
        action,
        `"${path}" is larger than the ${MAX_READ_BYTES}-byte limit for this action`,
        'download it through /dav instead',
      );
    default: {
      // Exhaustiveness: a new store refusal must be given a caller-facing
      // meaning here rather than falling through as a generic failure.
      const exhaustive: never = error.code;
      throw new Error(`unhandled webdav store error: ${String(exhaustive)}`);
    }
  }
}

/** Decode file bytes as text. A file that is not valid UTF-8 is refused
 * rather than returned as replacement characters — silent mojibake in an
 * agent's context is worse than a clear "this is not text". */
function decodeText(bytes: Uint8Array, action: string, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new IntegrationError(
      'LIVE_BODY_FAILED',
      `"${path}" is not UTF-8 text, so it cannot be read as content`,
      {
        connector: CONNECTOR,
        action,
        cause,
        hint: 'binary files are served by /dav, not by this action',
      },
    );
  }
}

// -------------------------------------------------------------------- actions

/**
 * The four `webdav` native backends, keyed by the impl id their connector
 * declares. Built around one store so a host wires storage once.
 */
export function webdavNatives(
  store: WebdavStore,
): Readonly<Record<string, NativeIntegrationImpl>> {
  const list: NativeIntegrationImpl = async (
    input: unknown,
    ctx: NativeIntegrationContext,
  ) => {
    const { path } = parseInput(pathInput, input, 'list');
    const segments = segmentsOf(path, 'list');
    const here = formatOrgPath(segments);
    let entries: readonly WebdavEntry[];
    try {
      entries = await store.list({
        organizationId: ctx.organizationId,
        segments,
      });
    } catch (error) {
      translateStoreError(error, 'list', here);
    }
    return {
      entries: entries.map((entry) => ({
        path: formatChildPath(segments, entry.name),
        name: entry.name,
        isDir: entry.isDir,
        size: entry.size,
      })),
    };
  };

  const read: NativeIntegrationImpl = async (
    input: unknown,
    ctx: NativeIntegrationContext,
  ) => {
    const { path } = parseInput(pathInput, input, 'read');
    const segments = segmentsOf(path, 'read');
    const here = formatOrgPath(segments);
    if (segments.length === 0) {
      throw refuse(
        'INPUT_INVALID',
        'read',
        'the organization root is a folder, not a file',
        'use webdav.list to see what it contains',
      );
    }
    let file: WebdavFileBytes;
    try {
      file = await store.read({
        organizationId: ctx.organizationId,
        segments,
        maxBytes: MAX_READ_BYTES,
      });
    } catch (error) {
      translateStoreError(error, 'read', here);
    }
    return {
      path: here,
      contentType: file.contentType ?? DEFAULT_CONTENT_TYPE,
      content: decodeText(file.bytes, 'read', here),
    };
  };

  const write: NativeIntegrationImpl = async (
    input: unknown,
    ctx: NativeIntegrationContext,
  ) => {
    const parsed = parseInput(writeInput, input, 'write');
    const segments = segmentsOf(parsed.path, 'write');
    const here = formatOrgPath(segments);
    if (segments.length === 0) {
      throw refuse(
        'INPUT_INVALID',
        'write',
        'a write needs a file path, not the organization root',
        'pass a path ending in a file name, e.g. "/reports/summary.md"',
      );
    }
    const bytes = new TextEncoder().encode(parsed.content);
    if (bytes.byteLength > MAX_WRITE_BYTES) {
      throw refuse(
        'INPUT_INVALID',
        'write',
        `content is ${bytes.byteLength} bytes, above the ${MAX_WRITE_BYTES}-byte limit for this action`,
        'upload larger files through /dav',
      );
    }
    try {
      await store.write({
        organizationId: ctx.organizationId,
        segments,
        bytes,
        contentType: parsed.contentType ?? DEFAULT_CONTENT_TYPE,
      });
    } catch (error) {
      translateStoreError(error, 'write', here);
    }
    return { path: here, bytesWritten: bytes.byteLength };
  };

  const remove: NativeIntegrationImpl = async (
    input: unknown,
    ctx: NativeIntegrationContext,
  ) => {
    const { path } = parseInput(pathInput, input, 'delete');
    const segments = segmentsOf(path, 'delete');
    const here = formatOrgPath(segments);
    if (segments.length === 0) {
      throw refuse(
        'INPUT_INVALID',
        'delete',
        'the organization root cannot be deleted',
        'delete a file or a folder inside it',
      );
    }
    let deleted: boolean;
    try {
      deleted = await store.remove({
        organizationId: ctx.organizationId,
        segments,
      });
    } catch (error) {
      translateStoreError(error, 'delete', here);
    }
    // A path that was already gone reports `deleted: false` instead of
    // failing: the caller's intent — nothing at this path — holds either way.
    return { path: here, deleted };
  };

  return {
    'webdav.list': list,
    'webdav.read': read,
    'webdav.write': write,
    'webdav.delete': remove,
  };
}

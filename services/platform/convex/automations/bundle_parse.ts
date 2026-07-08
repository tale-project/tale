/**
 * Decode + validate an uploaded automation bundle zip into the in-memory shape the
 * upload action writes to disk. Pure (operates on a `Uint8Array`, no I/O), so
 * the `'use node'` action and the unit test share one authoritative validator.
 * The client's `parse-automation-bundle.ts` re-runs the same checks for UX only.
 *
 * Bundle shape: a SINGLE top-level folder whose NAME is the automation slug, with
 * `automation.json` (the manifest) at its root — exactly the layout a user
 * gets by zipping their `my-automation/` directory, and what the folder-picker path
 * builds client-side. The legacy `app.json` name is DUAL-ACCEPTED too (an
 * export/zip authored before the Automations rename shipped — see
 * `file_utils.ts`'s DUAL-READ note); either way the re-emitted bundle always
 * carries the canonical name. Everything else (views/, agents/, workflows/,
 * scripts/, integrations/) is carried verbatim under the automation dir. A legacy
 * `messages/` dir (the retired per-bundle label catalog) is ACCEPTED and
 * carried as inert assets — old zips keep uploading; nothing reads those
 * files any more.
 */

import { ConvexError } from 'convex/values';
import JSZip from 'jszip';
import { z } from 'zod/v4';

import { validateViewBindings } from '../../lib/shared/platform/function_bindings';
import type { AutomationViewDoc } from '../../lib/shared/schemas/automation_views';
import {
  APP_MANIFEST_FILENAME,
  type AutomationManifest,
  AUTOMATION_MANIFEST_FILENAME,
  automationManifestSchema,
  isValidAutomationSlug,
  MAX_AUTOMATION_BUNDLE_ENTRIES,
  MAX_AUTOMATION_BUNDLE_FILE_BYTES,
  MAX_AUTOMATION_BUNDLE_TOTAL_BYTES,
} from '../../lib/shared/schemas/automations';
import { formatZodError } from '../../lib/shared/schemas/format-error';
import { collectAgentChatRoles, parseAutomationView } from './view_parse';

export interface ParsedAutomationBundleFile {
  /** Path relative to the automation dir (no leading slash, POSIX separators). */
  relPath: string;
  content: Uint8Array;
}

export interface ParsedAutomationBundle {
  /** Derived from the bundle's single top-level folder name. */
  slug: string;
  manifest: AutomationManifest;
  /** Includes the manifest (`automation.json`) as the first entry — always
   *  re-emitted under the canonical name, even when the upload carried the
   *  legacy `app.json` (see the DUAL-ACCEPT comment in `parseAutomationBundleZip`). */
  files: ParsedAutomationBundleFile[];
  /** Total decompressed bytes (manifest + every asset). */
  totalBytes: number;
}

/**
 * Drop OS-injected metadata entries that would otherwise pollute the bundle or
 * defeat the wrapper-folder detection. Mirrored on the client in
 * `parse-automation-bundle.ts`.
 */
function isOsMetadataEntry(name: string): boolean {
  if (name.startsWith('__MACOSX/') || name === '__MACOSX') return true;
  const basename = name.split('/').pop() ?? '';
  return basename === '.DS_Store' || basename === 'Thumbs.db';
}

/**
 * The single shared top-level folder of every entry, with its trailing slash
 * (e.g. `my-automation/`), or null when entries don't share exactly one — a root-level
 * file, or two different top folders. An automation bundle REQUIRES one: its name is
 * the slug.
 */
function detectSingleTopLevelFolder(names: string[]): string | null {
  let prefix: string | null = null;
  for (const name of names) {
    if (name === '') continue;
    const slash = name.indexOf('/');
    if (slash === -1) return null; // a root-level file disqualifies
    const top = name.slice(0, slash + 1);
    if (prefix === null) {
      prefix = top;
    } else if (prefix !== top) {
      return null;
    }
  }
  return prefix;
}

export async function parseAutomationBundleZip(
  bytes: Uint8Array,
): Promise<ParsedAutomationBundle> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err) {
    throw new ConvexError({
      code: 'INVALID_BUNDLE',
      message: `Not a valid zip archive: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const rawEntries = Object.entries(zip.files).filter(
    ([name]) => !isOsMetadataEntry(name),
  );
  if (rawEntries.length === 0) {
    throw new ConvexError({ code: 'INVALID_BUNDLE', message: 'Zip is empty' });
  }
  if (rawEntries.length > MAX_AUTOMATION_BUNDLE_ENTRIES) {
    throw new ConvexError({
      code: 'INVALID_BUNDLE',
      message: `Bundle contains ${rawEntries.length} entries (max ${MAX_AUTOMATION_BUNDLE_ENTRIES})`,
    });
  }

  const stripPrefix = detectSingleTopLevelFolder(rawEntries.map(([n]) => n));
  if (!stripPrefix) {
    throw new ConvexError({
      code: 'MISSING_WRAPPER_FOLDER',
      message:
        'Bundle must contain a single top-level folder named after the automation (its name becomes the automation slug).',
    });
  }
  const slug = stripPrefix.slice(0, -1); // strip trailing '/'
  if (!isValidAutomationSlug(slug)) {
    throw new ConvexError({
      code: 'INVALID_SLUG',
      message: `Folder name "${slug}" is not a valid automation slug (lowercase letters, digits and single hyphens; ≤64 chars).`,
    });
  }

  let manifestEntry: JSZip.JSZipObject | undefined;
  const assetEntries: { relPath: string; entry: JSZip.JSZipObject }[] = [];
  for (const [name, entry] of rawEntries) {
    if (entry.dir) continue;
    const rel = name.slice(stripPrefix.length);
    if (rel === '') continue;
    if (rel.includes('\0')) {
      throw new ConvexError({
        code: 'INVALID_BUNDLE',
        message: 'Bundle entry path contains NUL byte',
      });
    }
    if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
      throw new ConvexError({
        code: 'INVALID_BUNDLE',
        message: `Bundle entry uses absolute path: ${rel}`,
      });
    }
    const segments = rel.split('/');
    for (const seg of segments) {
      if (seg === '' || seg === '..' || seg === '.') {
        throw new ConvexError({
          code: 'INVALID_BUNDLE',
          message: `Bundle entry path is unsafe: ${rel}`,
        });
      }
    }
    // DUAL-ACCEPT: an uploaded zip may still carry the legacy `app.json` (it
    // was exported/authored before the Automations rename shipped) — see the
    // file header + `file_utils.ts`'s DUAL-READ note. Whichever name is
    // found, the parsed bundle is always re-emitted under the canonical
    // {@link AUTOMATION_MANIFEST_FILENAME} below (writers never emit the
    // legacy name).
    if (rel === AUTOMATION_MANIFEST_FILENAME || rel === APP_MANIFEST_FILENAME) {
      manifestEntry = entry;
      continue;
    }
    // Skip dotfiles silently (matches the on-disk listing's behaviour).
    if (segments.some((s) => s.startsWith('.'))) continue;
    assetEntries.push({ relPath: rel, entry });
  }

  if (!manifestEntry) {
    throw new ConvexError({
      code: 'MISSING_MANIFEST',
      message: `Bundle is missing ${AUTOMATION_MANIFEST_FILENAME} at the automation folder root`,
    });
  }

  // The name actually found (`automation.json` or the legacy `app.json`) —
  // used in error messages so they match what the operator actually zipped;
  // the RE-EMITTED file below is always the canonical name (see the loop's
  // DUAL-ACCEPT comment).
  const foundManifestName = manifestEntry.name.slice(stripPrefix.length);

  const manifestText = await manifestEntry.async('string');
  let manifest: AutomationManifest;
  try {
    manifest = automationManifestSchema.parse(JSON.parse(manifestText));
  } catch (err) {
    // A schema failure (ZodError) gets the shared field-path summary; a
    // malformed-JSON SyntaxError (or anything else) keeps its own message —
    // this is the third-party upload path an admin sees, so neither should
    // ever be the raw `[{"expected":...}]` issue-array dump.
    const detail =
      err instanceof z.ZodError
        ? formatZodError(err)
        : err instanceof Error
          ? err.message
          : String(err);
    throw new ConvexError({
      code: 'INVALID_MANIFEST',
      message: `${foundManifestName} rejected: ${detail}`,
    });
  }

  const files: ParsedAutomationBundleFile[] = [];
  const manifestBytes = new TextEncoder().encode(manifestText);
  if (manifestBytes.length > MAX_AUTOMATION_BUNDLE_FILE_BYTES) {
    throw new ConvexError({
      code: 'FILE_TOO_LARGE',
      message: `${foundManifestName} exceeds per-file cap of ${MAX_AUTOMATION_BUNDLE_FILE_BYTES} bytes`,
    });
  }
  let totalBytes = manifestBytes.length;
  files.push({ relPath: AUTOMATION_MANIFEST_FILENAME, content: manifestBytes });

  for (const { relPath, entry } of assetEntries) {
    const content = await entry.async('uint8array');
    if (content.length > MAX_AUTOMATION_BUNDLE_FILE_BYTES) {
      throw new ConvexError({
        code: 'FILE_TOO_LARGE',
        message: `Asset "${relPath}" exceeds per-file cap of ${MAX_AUTOMATION_BUNDLE_FILE_BYTES} bytes`,
      });
    }
    totalBytes += content.length;
    if (totalBytes > MAX_AUTOMATION_BUNDLE_TOTAL_BYTES) {
      throw new ConvexError({
        code: 'BUNDLE_TOO_LARGE',
        message: `Decompressed bundle exceeds ${MAX_AUTOMATION_BUNDLE_TOTAL_BYTES} bytes`,
      });
    }
    files.push({ relPath, content });
  }

  validateManifestReferences(slug, manifest, files);
  validateViewDocuments(manifest, files);

  return { slug, manifest, files, totalBytes };
}

/**
 * Fail fast on a manifest that references workflow/agent files the bundle
 * doesn't carry in the layout install expects — otherwise the upload succeeds
 * but `installAutomation` dies with a cryptic `ENOENT` when `registerWorkflow` /
 * `registerAgent` reads the file.
 *
 * Automation **workflows** are automation-scoped: they must be declared as `<slug>/<name>`
 * (the resolver routes that prefix to the automation dir; a bare slug would resolve to
 * the org's GLOBAL workflows dir) and carried at `workflows/<slug>/<name>.json`.
 * Automation **agents** are declared by bare name and carried at `agents/<name>.json`.
 * Automation **skills** are declared by bare slug and carried as a skill bundle at
 * `skills/<slug>/SKILL.md` (+ assets) — fanned into the org's shared skills
 * dir on install.
 */
function validateManifestReferences(
  slug: string,
  manifest: AutomationManifest,
  files: ParsedAutomationBundleFile[],
): void {
  const present = new Set(files.map((f) => f.relPath));

  for (const agent of manifest.agents ?? []) {
    const agentPath = `agents/${agent}.json`;
    if (!present.has(agentPath)) {
      throw new ConvexError({
        code: 'MISSING_AGENT_FILE',
        message: `Declared agent "${agent}" has no file at ${agentPath} in the bundle.`,
      });
    }
  }

  for (const skill of manifest.skills ?? []) {
    const skillPath = `skills/${skill}/SKILL.md`;
    if (!present.has(skillPath)) {
      throw new ConvexError({
        code: 'MISSING_SKILL_FILE',
        message: `Declared skill "${skill}" has no file at ${skillPath} in the bundle.`,
      });
    }
  }
}

/** Top-level view documents, exactly what discovery lists (`views/*.json`,
 *  non-recursive — a nested file would never be served, so it isn't gated). */
const VIEW_FILE_RE = /^views\/[^/]+\.json$/;

/**
 * Publish gate over the bundle's view documents — the checks discovery can only
 * tolerate (error stubs) are hard failures here, so a broken view never reaches
 * an org's disk: (a) every view parses against the strict `automationViewSchema`;
 * (b) every function a view binds is declared in `capabilities.functions`;
 * (c) every `AgentChat.role` is a key of the manifest's `roles` map.
 * Display strings are literals (platform-owned translations), so there is no
 * label-completeness gate any more.
 */
function validateViewDocuments(
  manifest: AutomationManifest,
  files: ParsedAutomationBundleFile[],
): void {
  const decoder = new TextDecoder();
  const views: { relPath: string; view: AutomationViewDoc }[] = [];

  for (const file of files) {
    if (!VIEW_FILE_RE.test(file.relPath)) continue;
    const result = parseAutomationView(
      file.relPath,
      decoder.decode(file.content),
    );
    if (!result.ok) {
      throw new ConvexError({
        code: 'INVALID_VIEW',
        message: result.error.message,
      });
    }
    views.push({ relPath: file.relPath, view: result.view });
  }
  if (views.length === 0) return;

  for (const { relPath, view } of views) {
    const errors = validateViewBindings(view, manifest.capabilities?.functions);
    if (errors.length > 0) {
      throw new ConvexError({
        code: 'VIEW_BINDING_NOT_ALLOWED',
        message: `${relPath}: ${errors.join('; ')}`,
      });
    }
  }

  for (const { relPath, view } of views) {
    for (const role of collectAgentChatRoles(view)) {
      if (manifest.roles?.[role] === undefined) {
        throw new ConvexError({
          code: 'VIEW_ROLE_UNKNOWN',
          message: `${relPath}: AgentChat role "${role}" is not declared in the manifest's roles map.`,
        });
      }
    }
  }
}

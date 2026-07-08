import JSZip from 'jszip';

import {
  collectAgentChatRoles,
  parseAutomationView,
} from '@/convex/automations/view_parse';
import { validateViewBindings } from '@/lib/shared/platform/function_bindings';
import type { AutomationViewDoc } from '@/lib/shared/schemas/automation_views';
import {
  APP_MANIFEST_FILENAME,
  type AutomationManifest,
  AUTOMATION_MANIFEST_FILENAME,
  automationManifestSchema,
  isValidAutomationSlug,
  MAX_AUTOMATION_BUNDLE_ENTRIES,
  MAX_AUTOMATION_BUNDLE_FILE_BYTES,
  MAX_AUTOMATION_BUNDLE_TOTAL_BYTES,
} from '@/lib/shared/schemas/automations';

export interface ParsedAutomationBundleFile {
  /** Path relative to the automation dir, POSIX separators, no leading slash. */
  relPath: string;
  size: number;
}

export interface ParsedAutomationBundle {
  /** The zip bytes to re-send to `_storage` (built from the folder if needed). */
  zipFile: File;
  /** Derived from the bundle's single top-level folder name. */
  slug: string;
  manifest: AutomationManifest;
  /** Asset entries (excludes the manifest). */
  assets: ParsedAutomationBundleFile[];
  /** Total decompressed bytes (the manifest + every asset). */
  totalBytes: number;
}

export type ParseResult =
  | { success: true; data: ParsedAutomationBundle }
  | { success: false; error: string };

function isOsMetadataEntry(name: string): boolean {
  if (name.startsWith('__MACOSX/') || name === '__MACOSX') return true;
  const basename = name.split('/').pop() ?? '';
  return basename === '.DS_Store' || basename === 'Thumbs.db';
}

function detectSingleTopLevelFolder(names: string[]): string | null {
  let prefix: string | null = null;
  for (const name of names) {
    if (name === '') continue;
    const slash = name.indexOf('/');
    if (slash === -1) return null;
    const top = name.slice(0, slash + 1);
    if (prefix === null) {
      prefix = top;
    } else if (prefix !== top) {
      return null;
    }
  }
  return prefix;
}

function formatMB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function formatKB(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * Validate + parse an automation bundle zip. Mirrors the server's
 * `convex/automations/bundle_parse.ts` — the server re-runs every check, so this is
 * purely UX feedback before submission. The bundle must contain a SINGLE
 * top-level folder (its name becomes the automation slug) with `automation.json`
 * at its root (legacy manifest names are accepted too — see `file_utils.ts`).
 */
export async function parseAutomationBundle(file: File): Promise<ParseResult> {
  if (!file.name.toLowerCase().endsWith('.zip')) {
    return { success: false, error: 'Bundle must be a .zip file.' };
  }
  if (file.size > MAX_AUTOMATION_BUNDLE_TOTAL_BYTES) {
    return {
      success: false,
      error: `Bundle is larger than ${formatMB(MAX_AUTOMATION_BUNDLE_TOTAL_BYTES)}.`,
    };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch (err) {
    return {
      success: false,
      error: `Not a valid zip archive: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const rawEntries = Object.entries(zip.files).filter(
    ([name]) => !isOsMetadataEntry(name),
  );
  if (rawEntries.length === 0) {
    return { success: false, error: 'Zip is empty.' };
  }
  if (rawEntries.length > MAX_AUTOMATION_BUNDLE_ENTRIES) {
    return {
      success: false,
      error: `Bundle has ${rawEntries.length} entries (max ${MAX_AUTOMATION_BUNDLE_ENTRIES}).`,
    };
  }

  const stripPrefix = detectSingleTopLevelFolder(rawEntries.map(([n]) => n));
  if (!stripPrefix) {
    return {
      success: false,
      error:
        'Bundle must contain a single top-level folder named after the automation.',
    };
  }
  const slug = stripPrefix.slice(0, -1);
  if (!isValidAutomationSlug(slug)) {
    return {
      success: false,
      error: `Folder name "${slug}" is not a valid automation slug (lowercase letters, digits and single hyphens; ≤64 chars).`,
    };
  }

  let manifestEntry: JSZip.JSZipObject | undefined;
  const assets: { relPath: string; entry: JSZip.JSZipObject }[] = [];
  for (const [name, entry] of rawEntries) {
    if (entry.dir) continue;
    const rel = name.slice(stripPrefix.length);
    if (rel === '') continue;
    if (rel.includes('\0') || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
      return { success: false, error: `Entry uses an unsafe path: ${rel}` };
    }
    const segments = rel.split('/');
    if (segments.some((s) => s === '' || s === '..' || s === '.')) {
      return { success: false, error: `Entry path is unsafe: ${rel}` };
    }
    // DUAL-ACCEPT: mirrors the server's `bundle_parse.ts` — a zip authored
    // before the Automations rename shipped may still carry the legacy
    // `app.json` (see `convex/automations/file_utils.ts`'s DUAL-READ note).
    if (rel === AUTOMATION_MANIFEST_FILENAME || rel === APP_MANIFEST_FILENAME) {
      manifestEntry = entry;
      continue;
    }
    if (segments.some((s) => s.startsWith('.'))) continue;
    assets.push({ relPath: rel, entry });
  }

  if (!manifestEntry) {
    return {
      success: false,
      error: `Bundle is missing ${AUTOMATION_MANIFEST_FILENAME} at the automation folder root.`,
    };
  }
  const foundManifestName = manifestEntry.name.slice(stripPrefix.length);

  const manifestText = await manifestEntry.async('string');
  let manifest: AutomationManifest;
  try {
    manifest = automationManifestSchema.parse(JSON.parse(manifestText));
  } catch (err) {
    return {
      success: false,
      error: `${foundManifestName} rejected: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const manifestBytes = new TextEncoder().encode(manifestText).length;
  if (manifestBytes > MAX_AUTOMATION_BUNDLE_FILE_BYTES) {
    return {
      success: false,
      error: `${foundManifestName} exceeds per-file cap of ${formatKB(MAX_AUTOMATION_BUNDLE_FILE_BYTES)}.`,
    };
  }
  let totalBytes = manifestBytes;

  const assetMeta: ParsedAutomationBundleFile[] = [];
  // View texts, kept for the publish-mirror checks below.
  const decoder = new TextDecoder();
  const viewTexts: { relPath: string; text: string }[] = [];
  for (const { relPath, entry } of assets) {
    const buf = await entry.async('uint8array');
    if (buf.length > MAX_AUTOMATION_BUNDLE_FILE_BYTES) {
      return {
        success: false,
        error: `Asset "${relPath}" exceeds per-file cap of ${formatKB(MAX_AUTOMATION_BUNDLE_FILE_BYTES)}.`,
      };
    }
    totalBytes += buf.length;
    if (totalBytes > MAX_AUTOMATION_BUNDLE_TOTAL_BYTES) {
      return {
        success: false,
        error: `Decompressed bundle exceeds ${formatMB(MAX_AUTOMATION_BUNDLE_TOTAL_BYTES)}.`,
      };
    }
    if (VIEW_FILE_RE.test(relPath)) {
      viewTexts.push({ relPath, text: decoder.decode(buf) });
    }
    assetMeta.push({ relPath, size: buf.length });
  }

  assetMeta.sort((a, b) => a.relPath.localeCompare(b.relPath));

  // Mirror the server's manifest↔file consistency check (bundle_parse.ts) so a
  // malformed automation is caught here instead of failing install with a cryptic
  // ENOENT: a declared agent is a bare name carried at `agents/<name>.json`.
  const present = new Set(assetMeta.map((a) => a.relPath));
  for (const agent of manifest.agents ?? []) {
    if (!present.has(`agents/${agent}.json`)) {
      return {
        success: false,
        error: `Declared agent "${agent}" has no file at agents/${agent}.json in the bundle.`,
      };
    }
  }

  const viewError = validateViewDocuments(manifest, viewTexts);
  if (viewError !== null) return { success: false, error: viewError };

  return {
    success: true,
    data: { zipFile: file, slug, manifest, assets: assetMeta, totalBytes },
  };
}

/** Top-level view documents, exactly what discovery serves (non-recursive). */
const VIEW_FILE_RE = /^views\/[^/]+\.json$/;

/**
 * Client mirror of the publish gate's view checks (`bundle_parse.ts::
 * validateViewDocuments`) — the same shared helpers, returning the first error
 * as a string (this path is UX feedback only; the server re-runs everything):
 * strict schema parse, binding allowlist, and `AgentChat.role ∈
 * manifest.roles`. Display strings are literals (platform-owned translations),
 * so there is no label-completeness check; a legacy `messages/` dir is carried
 * as inert assets.
 */
function validateViewDocuments(
  manifest: AutomationManifest,
  viewTexts: { relPath: string; text: string }[],
): string | null {
  const views: { relPath: string; view: AutomationViewDoc }[] = [];
  for (const { relPath, text } of viewTexts) {
    const result = parseAutomationView(relPath, text);
    if (!result.ok) return result.error.message;
    views.push({ relPath, view: result.view });
  }
  if (views.length === 0) return null;

  for (const { relPath, view } of views) {
    const errors = validateViewBindings(view, manifest.capabilities?.functions);
    if (errors.length > 0) return `${relPath}: ${errors.join('; ')}`;
  }

  for (const { relPath, view } of views) {
    for (const role of collectAgentChatRoles(view)) {
      if (manifest.roles?.[role] === undefined) {
        return `${relPath}: AgentChat role "${role}" is not declared in the manifest's roles map.`;
      }
    }
  }
  return null;
}

/**
 * Parse a directory the user picked via a `webkitdirectory` input. Each file's
 * `webkitRelativePath` already carries the selected folder as its first segment
 * (e.g. `my-automation/automation.json`), so we zip them verbatim into a single-wrapper-folder
 * bundle and run it through {@link parseAutomationBundle} — one validation path, and
 * the resulting `zipFile` is what gets uploaded.
 */
export async function parseAutomationFolder(
  files: File[],
): Promise<ParseResult> {
  const usable = files.filter((f) => {
    const rel = relPathOf(f);
    return rel !== '' && !isOsMetadataEntry(rel);
  });
  if (usable.length === 0) {
    return { success: false, error: 'The selected folder is empty.' };
  }

  const topFolder = detectSingleTopLevelFolder(usable.map(relPathOf));
  if (!topFolder) {
    return {
      success: false,
      error: `Select a single automation folder with ${AUTOMATION_MANIFEST_FILENAME} at its root.`,
    };
  }

  const zip = new JSZip();
  for (const file of usable) {
    zip.file(relPathOf(file), await file.arrayBuffer());
  }
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
  });
  const slug = topFolder.slice(0, -1);
  const zipFile = new File([blob], `${slug}.zip`, { type: 'application/zip' });
  return parseAutomationBundle(zipFile);
}

/** A `webkitdirectory` File exposes its in-folder path here; fall back to name. */
function relPathOf(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string })
    .webkitRelativePath;
  return rel && rel.length > 0 ? rel : file.name;
}

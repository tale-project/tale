/**
 * Decode + validate an uploaded automation package zip into the in-memory
 * shape the upload action consumes. Pure (operates on a `Uint8Array`, no I/O),
 * so the `'use node'` action and the unit test share one authoritative
 * validator.
 *
 * Package shape — the pack format's own directory, zipped: `workflow.yml`
 * (required; `.yaml`/`.json` accepted), `automation.yml` (optional manifest)
 * and any carried skill bundles under `skills/<slug>/`. The document may sit
 * at the zip root or inside ONE wrapper folder — exactly what a user gets by
 * zipping their pack directory. Markdown outside `skills/` (a README, design
 * notes) is skipped silently, like dotfiles, build residue (`__pycache__/`,
 * `node_modules/` — the skills domain's own walk exclusions, which its write
 * guard would refuse anyway) and OS metadata; every other stray entry
 * refuses loudly. Unlike the retired bundle format, the
 * automation's name comes from the document, never from the folder path, so
 * nested wrappers are not a thing.
 *
 * Every carried skill is validated as a REAL skill — frontmatter parsed, slug
 * checked against the skills domain's own grammar, `meta.name` required to
 * equal the directory name — because the fan-out writes it into the org's
 * shared skills dir, where a malformed bundle would poison every staging read.
 * (The retired bundle format only checked that SKILL.md existed; packages a
 * skill the standalone skill surface would refuse were fanned out anyway.
 * That gap is closed on purpose.)
 *
 * This module must stay OUT of the V8 bundle (jszip) — import it only from
 * `'use node'` modules; see the note in `convex/documents/helpers.ts`.
 */

import JSZip from 'jszip';

import { AppError } from '../../lib/shared/errors/app-error';
import {
  MAX_AUTOMATION_BUNDLE_ENTRIES,
  MAX_AUTOMATION_BUNDLE_FILE_BYTES,
  MAX_AUTOMATION_BUNDLE_TOTAL_BYTES,
} from '../../lib/shared/schemas/automations';
import {
  isSkillBundleExcludedSegment,
  isValidSkillSlug,
  MAX_SKILL_BUNDLE_FILES,
} from '../../lib/shared/schemas/skills';
import { parseSkillMd, SkillParseError } from '../../lib/skills/parse';
import { isRecord } from '../../lib/utils/type-utils';

const DOCUMENT_NAMES = new Set([
  'workflow.yml',
  'workflow.yaml',
  'workflow.json',
]);
const MANIFEST_NAMES = new Set(['automation.yml', 'automation.yaml']);
const SKILL_MD = 'SKILL.md';

export interface CarriedSkillFile {
  /** Path relative to the skill's own directory (`SKILL.md`, `scripts/run.py`). */
  path: string;
  content: Uint8Array;
}

export interface CarriedSkill {
  /** The `skills/<slug>/` directory name — the skills-domain identity. */
  slug: string;
  /** The decoded SKILL.md, already frontmatter-validated. */
  skillMdText: string;
  /** Every file of the bundle, SKILL.md included. */
  files: CarriedSkillFile[];
}

export interface ParsedAutomationPackZip {
  document: { name: string; text: string };
  manifest?: { name: string; text: string };
  /** Sorted by slug. */
  skills: CarriedSkill[];
  /** Total decompressed bytes across every kept file. */
  totalBytes: number;
}

function refuse(code: string, message: string): never {
  throw new AppError({ code, message });
}

/** OS-injected metadata that would defeat wrapper detection. */
function isOsMetadataEntry(name: string): boolean {
  if (name.startsWith('__MACOSX/') || name === '__MACOSX') return true;
  const basename = name.split('/').pop() ?? '';
  return basename === '.DS_Store' || basename === 'Thumbs.db';
}

/**
 * Zip-slip defense, ported from the retired bundle parser: refuse NUL bytes,
 * absolute and drive-letter paths, and `''`/`.`/`..` segments outright. A
 * dotfile or build-residue SEGMENT is not an attack, merely noise — the
 * caller skips those silently.
 */
function assertSafeEntryPath(name: string): void {
  if (name.includes('\0')) {
    refuse('PACK_PATH_UNSAFE', 'Zip entry path contains a NUL byte');
  }
  if (
    name.startsWith('/') ||
    name.startsWith('\\') ||
    /^[A-Za-z]:/.test(name)
  ) {
    refuse('PACK_PATH_UNSAFE', `Zip entry path is absolute: ${name}`);
  }
  for (const segment of name.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      refuse(
        'PACK_PATH_UNSAFE',
        `Zip entry path has an unsafe segment: ${name}`,
      );
    }
  }
}

/**
 * True when any segment is one the skills domain excludes from bundles:
 * dot-entries (`.pytest_cache/`, `.gitignore`) or build/dependency residue
 * (`__pycache__/`, `node_modules/`). Zipping a tested working directory
 * inevitably carries these; they are dropped here so the upload installs
 * exactly what the bundle walk would later stage — the write side refuses
 * such paths, so letting them through would fail the whole upload.
 */
function hasExcludedSegment(name: string): boolean {
  return name.split('/').some(isSkillBundleExcludedSegment);
}

/**
 * The prefix every kept entry must live under: `''` when a workflow document
 * sits at the zip root, otherwise the single shared top-level folder (the
 * wrapper a user gets by zipping the pack directory itself).
 */
function detectRoot(names: string[]): string {
  const atRoot = names.some(
    (name) => !name.includes('/') && DOCUMENT_NAMES.has(name.toLowerCase()),
  );
  if (atRoot) return '';
  let wrapper: string | null = null;
  for (const name of names) {
    const slash = name.indexOf('/');
    if (slash === -1) {
      refuse(
        'MISSING_DOCUMENT',
        'No workflow.yml at the package root — zip the pack directory (workflow.yml + automation.yml + skills/).',
      );
    }
    const top = name.slice(0, slash + 1);
    if (wrapper === null) wrapper = top;
    else if (wrapper !== top) {
      refuse(
        'INVALID_PACK',
        'The zip must hold ONE pack — a workflow.yml at the root or a single wrapper folder.',
      );
    }
  }
  return wrapper ?? '';
}

export async function parseAutomationPackZip(
  bytes: Uint8Array,
): Promise<ParsedAutomationPackZip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (error) {
    refuse(
      'INVALID_PACK',
      `Not a valid zip archive: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const entries = Object.entries(zip.files).filter(
    ([name]) => !isOsMetadataEntry(name),
  );
  if (entries.length === 0) refuse('INVALID_PACK', 'Zip is empty');
  if (entries.length > MAX_AUTOMATION_BUNDLE_ENTRIES) {
    refuse(
      'PACK_TOO_LARGE',
      `Package holds ${entries.length} entries (max ${MAX_AUTOMATION_BUNDLE_ENTRIES})`,
    );
  }
  for (const [name] of entries) assertSafeEntryPath(name.replace(/\/$/, ''));

  const fileEntries = entries.filter(([, entry]) => !entry.dir);
  const root = detectRoot(fileEntries.map(([name]) => name));

  let document: { name: string; text: string } | undefined;
  let manifest: { name: string; text: string } | undefined;
  const skillFiles = new Map<string, CarriedSkillFile[]>();
  let totalBytes = 0;
  const decoder = new TextDecoder();

  for (const [name, entry] of fileEntries) {
    if (!name.startsWith(root)) {
      refuse('PACK_UNEXPECTED_ENTRY', `Entry outside the pack root: ${name}`);
    }
    const relPath = name.slice(root.length);
    if (hasExcludedSegment(relPath)) continue;

    const basename = relPath.split('/').pop() ?? '';
    const isDocument =
      !relPath.includes('/') && DOCUMENT_NAMES.has(basename.toLowerCase());
    const isManifest =
      !relPath.includes('/') && MANIFEST_NAMES.has(basename.toLowerCase());
    const isSkillFile = relPath.startsWith('skills/');
    if (!isDocument && !isManifest && !isSkillFile) {
      // Markdown outside skills/ is notes for humans (README, design records),
      // never payload — skip it like dotfiles. Anything else refuses loudly so
      // nobody believes an agents/ or views/ directory took effect.
      if (basename.toLowerCase().endsWith('.md')) continue;
      refuse(
        'PACK_UNEXPECTED_ENTRY',
        `Unexpected entry "${relPath}" — a package holds workflow.yml, automation.yml and skills/<slug>/ only (markdown notes are ignored).`,
      );
    }

    const content = await entry.async('uint8array');
    if (content.byteLength > MAX_AUTOMATION_BUNDLE_FILE_BYTES) {
      refuse(
        'PACK_FILE_TOO_LARGE',
        `${relPath} is ${content.byteLength} bytes (max ${MAX_AUTOMATION_BUNDLE_FILE_BYTES})`,
      );
    }
    totalBytes += content.byteLength;
    if (totalBytes > MAX_AUTOMATION_BUNDLE_TOTAL_BYTES) {
      refuse(
        'PACK_TOO_LARGE',
        `Package exceeds ${MAX_AUTOMATION_BUNDLE_TOTAL_BYTES} decompressed bytes`,
      );
    }

    if (isDocument) {
      if (document !== undefined) {
        refuse(
          'INVALID_PACK',
          `More than one workflow document: ${document.name} and ${basename}`,
        );
      }
      document = { name: basename, text: decoder.decode(content) };
      continue;
    }
    if (isManifest) {
      if (manifest !== undefined) {
        refuse(
          'INVALID_PACK',
          `More than one manifest: ${manifest.name} and ${basename}`,
        );
      }
      manifest = { name: basename, text: decoder.decode(content) };
      continue;
    }

    const segments = relPath.split('/');
    if (segments.length < 3) {
      refuse(
        'PACK_UNEXPECTED_ENTRY',
        `"${relPath}" sits directly under skills/ — a skill is a directory: skills/<slug>/SKILL.md`,
      );
    }
    const slug = segments[1] ?? '';
    const bucket = skillFiles.get(slug) ?? [];
    bucket.push({ path: segments.slice(2).join('/'), content });
    skillFiles.set(slug, bucket);
  }

  if (document === undefined) {
    refuse(
      'MISSING_DOCUMENT',
      'No workflow document found — include a workflow.yml (or .yaml/.json).',
    );
  }

  const skills: CarriedSkill[] = [];
  for (const [slug, files] of [...skillFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!isValidSkillSlug(slug)) {
      refuse(
        'INVALID_SKILL_SLUG',
        `"${slug}" is not a valid skill slug (lowercase letters, digits, single hyphens, not reserved).`,
      );
    }
    if (files.length > MAX_SKILL_BUNDLE_FILES) {
      refuse(
        'PACK_TOO_LARGE',
        `Skill "${slug}" carries ${files.length} files (max ${MAX_SKILL_BUNDLE_FILES})`,
      );
    }
    const skillMd = files.find((file) => file.path === SKILL_MD);
    if (skillMd === undefined) {
      refuse(
        'MISSING_SKILL_FILE',
        `Carried skill "${slug}" has no file at skills/${slug}/${SKILL_MD}.`,
      );
    }
    const skillMdText = decoder.decode(skillMd.content);
    let meta;
    try {
      meta = parseSkillMd(skillMdText, `skills/${slug}/${SKILL_MD}`).meta;
    } catch (error) {
      if (error instanceof SkillParseError) {
        refuse('INVALID_SKILL_MD', error.message);
      }
      throw error;
    }
    if (meta.name !== slug) {
      refuse(
        'SKILL_NAME_MISMATCH',
        `skills/${slug}/${SKILL_MD} names itself "${meta.name}" — the frontmatter name must equal the directory.`,
      );
    }
    if (meta.visibility === 'private') {
      refuse(
        'CARRIED_SKILL_PRIVATE',
        `Carried skill "${slug}" declares visibility: private — a package skill becomes an organization asset.`,
      );
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    skills.push({ slug, skillMdText, files });
  }

  return { document, ...(manifest ? { manifest } : {}), skills, totalBytes };
}

/**
 * Every skill slug the document references — the agent node's `skills` list
 * and the sandbox script capability's `input.skill` — so the upload can warn
 * when a reference resolves to neither a carried skill nor an existing org
 * one. Templated values (`{{ … }}`) resolve at run time and are skipped.
 */
export function collectSkillReferences(document: unknown): string[] {
  if (!isRecord(document) || !Array.isArray(document.nodes)) return [];
  const referenced = new Set<string>();
  const keep = (value: unknown): void => {
    if (typeof value === 'string' && value !== '' && !value.includes('{{')) {
      referenced.add(value);
    }
  };
  for (const node of document.nodes) {
    if (!isRecord(node)) continue;
    if (node.type === 'agent' && Array.isArray(node.skills)) {
      for (const slug of node.skills) keep(slug);
    }
    if (node.type === 'sandbox.run_script' && isRecord(node.input)) {
      keep(node.input.skill);
    }
  }
  return [...referenced].sort((a, b) => a.localeCompare(b));
}

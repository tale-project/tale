/**
 * THE reader for the shipped automation packs —
 * `configs/platform/custom/automations/<path>/`.
 *
 * A pack is a directory holding three files: `automation.yml` (everything
 * about the automation that is not its behaviour — display text, labels, the
 * connectors it needs, the triggers it wants), `workflow.yml` (the v1
 * automation document that actually runs — the file name is the one every
 * shipped and per-organization catalog on disk already uses, so it stays) and
 * `icon.svg`. The directory PATH is the slug, so `gmail/triage-inbox` is both
 * where the pack lives and what it is called; a pack directory may sit at any
 * depth up to {@link MAX_PACK_DEPTH}.
 *
 * The shared automation-pack contract validates the manifest. The
 * DOCUMENT is not validated here: the engine's `validate` is the single source of truth for
 * what a document may contain, and re-declaring the node grammar in a Zod
 * schema would create a second one that drifts. This reader only proves the
 * file parses and carries the two fields a document is addressed by; the pack
 * suite then runs the engine's validator over every shipped document.
 *
 * Reading the catalog needs the filesystem, so consumers are node-side
 * (scripts, tests, `'use node'` actions) — never a Convex V8 function.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  automationPackManifestSchema,
  type AutomationPackManifest,
} from '@tale/shared/schemas/automation-pack';

import type { Automation } from '../engine/core/types';
import { parseYamlOrThrow } from '../shared/config/yaml';
import { zodErrorMessage } from '../shared/schemas/format-error';
import { isRecord } from '../utils/type-utils';

/** Repo-relative location of the per-org seed catalog. */
const REPO_CUSTOM_CATALOG = ['configs', 'platform', 'custom'] as const;

const AUTOMATION_MANIFEST_FILE = 'automation.yml';
const AUTOMATION_WORKFLOW_FILE = 'workflow.yml';

/** Slug depth cap, and therefore the recursion bound of the walk below: a
 * path the reader accepts can never be a path the walk refuses to reach. */
const MAX_PACK_DEPTH = 4;

/** One pack file may not exceed this — a pack is configuration. */
const MAX_PACK_BYTES = 256 * 1024;

export interface AutomationPack {
  /** `/`-separated path of kebab segments — the directory it lives in. */
  readonly slug: string;
  readonly dir: string;
  readonly manifest: AutomationPackManifest;
  readonly automation: Automation;
}

export interface LoadPacksOptions {
  /** Absolute path of the `custom/` catalog directory (the one containing
   * `automations/`). Defaults to the repo walk-up. */
  readonly root?: string;
}

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    // A missing path is the ordinary walk-up miss, not an error.
    return false;
  }
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Walk up from `startDir` looking for `configs/platform/custom/`. */
function findRepoCatalog(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, ...REPO_CUSTOM_CATALOG);
    if (isDirectory(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The directory the packs live in. */
function resolveAutomationsDir(options: LoadPacksOptions = {}): string {
  const root = options.root ?? findRepoCatalog(process.cwd());
  if (root === null) {
    throw new Error(
      '[automations] no builtin catalog found: pass an explicit root or run inside a checkout with configs/platform/custom',
    );
  }
  return path.join(root, 'automations');
}

function readYamlFile(file: string): unknown {
  return parseYamlOrThrow(readFileSync(file, 'utf8'), {
    maxBytes: MAX_PACK_BYTES,
  });
}

/** The engine owns document validation; this only proves the file is a
 * document at all, so a packaging mistake is reported with its path instead
 * of surfacing later as a confusing validation error. */
function asAutomationDocument(value: unknown, file: string): Automation {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.nodes)
  ) {
    throw new Error(
      `[automations] ${file} is not an automation document: it needs at least a "name" and a "nodes" list`,
    );
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the two addressing fields are checked above; the engine's validate() is the full contract and every shipped pack is run through it
  return value as unknown as Automation;
}

/** Read one pack directory. `slug` is its path below `automations/`. */
function loadAutomationPack(dir: string, slug: string): AutomationPack {
  const manifestFile = path.join(dir, AUTOMATION_MANIFEST_FILE);
  const parsed = automationPackManifestSchema.safeParse(
    readYamlFile(manifestFile),
  );
  if (!parsed.success) {
    throw new Error(
      `[automations] manifest ${manifestFile} is invalid: ${zodErrorMessage('it', parsed.error)}`,
    );
  }
  const automationFile = path.join(dir, AUTOMATION_WORKFLOW_FILE);
  if (!isFile(automationFile)) {
    throw new Error(
      `[automations] pack "${slug}" has no ${AUTOMATION_WORKFLOW_FILE} beside its manifest`,
    );
  }
  return {
    slug,
    dir,
    manifest: parsed.data,
    automation: asAutomationDocument(
      readYamlFile(automationFile),
      automationFile,
    ),
  };
}

/**
 * Every shipped pack, sorted by slug. A directory holding a manifest IS a
 * pack; any other directory is walked into, so packs group into folders
 * (`github/…`) exactly the way their slugs read.
 */
export function loadAutomationPacks(
  options: LoadPacksOptions = {},
): AutomationPack[] {
  const root = resolveAutomationsDir(options);
  const packs: AutomationPack[] = [];

  const walk = (dir: string, segments: readonly string[]): void => {
    if (segments.length > MAX_PACK_DEPTH) return;
    if (
      segments.length > 0 &&
      isFile(path.join(dir, AUTOMATION_MANIFEST_FILE))
    ) {
      packs.push(loadAutomationPack(dir, segments.join('/')));
      return;
    }
    for (const entry of readdirSync(dir).sort()) {
      const child = path.join(dir, entry);
      if (isDirectory(child)) walk(child, [...segments, entry]);
    }
  };

  if (isDirectory(root)) walk(root, []);
  return packs.sort((a, b) => a.slug.localeCompare(b.slug));
}

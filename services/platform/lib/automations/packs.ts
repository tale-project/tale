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
 * The manifest is validated here because it is this module's own grammar. The
 * DOCUMENT is not: the engine's `validate` is the single source of truth for
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

import { z } from 'zod/v4';

import type { Automation } from '../engine/core/types';
import { parseYamlOrThrow } from '../shared/config/yaml';
import { zodErrorMessage } from '../shared/schemas/format-error';
import { taskSubjectContractSchema } from '../shared/schemas/task_contract';
import { isRecord } from '../utils/type-utils';

/** Repo-relative location of the per-org seed catalog. */
const REPO_CUSTOM_CATALOG = ['configs', 'platform', 'custom'] as const;

export const AUTOMATION_MANIFEST_FILE = 'automation.yml';
export const AUTOMATION_WORKFLOW_FILE = 'workflow.yml';

/** Slug depth cap, and therefore the recursion bound of the walk below: a
 * path the reader accepts can never be a path the walk refuses to reach. */
export const MAX_PACK_DEPTH = 4;

/** One pack file may not exceed this — a pack is configuration. */
const MAX_PACK_BYTES = 256 * 1024;

/**
 * What starts a pack's automation. The kinds mirror the trigger store: a pack
 * DECLARES what it wants and the host creates the binding once per
 * organization, so an organization's own edits always win afterwards. There is
 * no `api-key` kind — a programmatic start is what the REST and MCP surfaces
 * are for, and the store refuses the kind, so a pack that declared it would ask
 * for a binding that cannot be created.
 */
export const automationTriggerSchema = z
  .object({
    kind: z.enum(['schedule', 'webhook', 'event']),
    /** Cron expression, for `schedule`. */
    cron: z.string().min(1).optional(),
    /** IANA timezone the cron is read in, for `schedule`. */
    timezone: z.string().min(1).optional(),
    /** Platform event name, for `event`. */
    event: z.string().min(1).optional(),
  })
  .strict();

/** Per-locale overrides for the manifest's display text; absent locales fall
 * back to the top-level fields, which are authored in English. */
const packI18nSchema = z.record(
  z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  z
    .object({
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).optional(),
    })
    .strict(),
);

export const automationPackManifestSchema = z
  .object({
    /** Display name; the slug is the directory path. */
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    /** Lucide icon name for the automation card. */
    icon: z.string().min(1).optional(),
    /** Short catalog chips — proper nouns, left untranslated. */
    labels: z.array(z.string().min(1)).max(6).optional(),
    /** Where the automation installs and runs; absent means org-level. */
    scope: z.enum(['org', 'project']).optional(),
    /** Kept out of the catalog listing. */
    hidden: z.boolean().optional(),
    /** What must be connected before the automation can run. */
    requires: z
      .object({ integrations: z.array(z.string().min(1)).optional() })
      .strict()
      .optional(),
    triggers: z.array(automationTriggerSchema).optional(),
    /** Task-surface bindings: `subjects.task` is the contract the task board
     * choreographs against once the pack is installed and deployed. */
    subjects: z
      .object({ task: taskSubjectContractSchema.optional() })
      .strict()
      .optional(),
    i18n: packI18nSchema.optional(),
  })
  .strict();

export type AutomationPackManifest = z.infer<
  typeof automationPackManifestSchema
>;
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

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
export function resolveAutomationsDir(options: LoadPacksOptions = {}): string {
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
export function loadAutomationPack(dir: string, slug: string): AutomationPack {
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

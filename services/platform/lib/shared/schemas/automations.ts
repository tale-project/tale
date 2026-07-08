/**
 * Automation manifest (`automations/<slug>/automation.json`) — a first-class composition unit.
 *
 * An automation is the end-user product: it COMPOSES platform building blocks
 * (workflows + agents, referenced by slug) and OWNS its UI (`views/*.json`),
 * its bundled assets (`scripts/`), and its role→agent map. Display strings are
 * literals; a manifest translates ITSELF via an inline per-locale `i18n` block
 * (the agent/workflow convention — `agents.ts#agentJsonSchema`,
 * `workflows.ts#workflowI18nSchema`), resolved through
 * `lib/shared/utils/resolve-automation-locale.ts`. The retired per-bundle
 * `messages/` label catalog is no longer read. It is deliberately NOT a skill
 * — skills are agent capabilities spliced into agent prompts; an automation may
 * reference a skill as one ingredient, but isn't one. Automations lists
 * automations; `pack://<automation>/...` asset refs (e.g. a workflow's sandbox
 * script) resolve against the automation's bundle.
 */
import { z } from 'zod';

import { workflowJsonSchema } from './workflows';

/**
 * A platform-rendered ("builtin") view an automation declares INSTEAD of shipping its
 * own JSON view document: the UI lives in the platform codebase (registry at
 * `automation/features/automations/builtin-views/`), its strings in the platform
 * message catalogs — the manifest only opts in. `id` is a CLOSED enum: an
 * unknown id cannot ship, and the client registry is the single renderer.
 * `config` carries optional scalar knobs for a view that needs them; the inbox
 * view needs none (it derives its provider from `requires.integrations`).
 */
export const automationBuiltinViewSchema = z.object({
  id: z.enum(['inbox']),
  config: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
});

export type AutomationBuiltinView = z.infer<typeof automationBuiltinViewSchema>;

/**
 * A display folder path: '/'-separated lowercase kebab/underscore segments
 * (e.g. `github/issues`). No leading/trailing slash, no empty segments, no
 * `__` runs — the same alphabet folder-grouped lists already render.
 */
const AUTOMATION_FOLDER_REGEX =
  /^(?!.*__)[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/;

/**
 * Per-locale overrides for one declared config field's display strings — the
 * translated twins of `formFieldSchema`'s literal `label`/`placeholder`/`help`.
 */
const automationConfigFieldI18nSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  placeholder: z.string().max(500).optional(),
  help: z.string().max(1000).optional(),
});

/**
 * Per-locale overrides for the manifest's own display fields, mirroring the
 * agent/workflow i18n-first model (`agents.ts#agentJsonSchema`,
 * `workflows.ts#workflowI18nSchema`): absent locales fall back to the
 * top-level literals (authored in English). `config` is keyed by the
 * `requires.config` field `key`. Resolve via
 * `lib/shared/utils/resolve-automation-locale.ts` — never index this directly.
 */
export const automationManifestI18nSchema = z.record(
  z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    config: z.record(z.string(), automationConfigFieldI18nSchema).optional(),
  }),
);

export type AutomationManifestI18n = z.infer<
  typeof automationManifestI18nSchema
>;

export const automationManifestSchema = z
  .object({
    /** Friendly display name shown in Automations (the slug is the dir name). */
    name: z.string(),
    description: z.string().optional(),
    /**
     * Hidden from Automations / catalog listing (`listAutomations`/`listCatalogAutomations`
     * filter it out) — absent/false means visible, the default every automation
     * authored before bundles existed keeps. Set on a MEMBER automation folded
     * into a {@link bundle}'s aggregated install wizard: it still installs and
     * runs exactly like any other automation, it is just never browsed or installed
     * standalone from the hub. The assistant's `automation_search` tool sees
     * hidden automations too (it needs the full picture to avoid authoring a
     * duplicate).
     */
    hidden: z.boolean().optional(),
    /** Per-locale display overrides; see {@link automationManifestI18nSchema}. */
    i18n: automationManifestI18nSchema.optional(),
    /** Optional lucide icon name for the automation card. */
    icon: z.string().optional(),
    /**
     * Display folder the automation's agents/workflows group under in the global
     * lists; absent ⇒ automation slug. DISPLAY ONLY — slugs, on-disk paths, and env
     * namespaces stay keyed by the automation slug. Resolve via {@link automationDisplayFolder}.
     */
    folder: z.string().max(64).regex(AUTOMATION_FOLDER_REGEX).optional(),
    /**
     * Short catalog labels shown as chips on the hub card and the automation details
     * header (e.g. "GitHub", "Email"). LITERAL display strings — the hub
     * renders them pre-install exactly like the literal `name`/`description`,
     * and they are proper nouns that stay untranslated.
     */
    labels: z.array(z.string()).max(6).optional(),
    /**
     * Where the automation installs and runs. `org` (default) — an org-level automation, used
     * from Automations. `project` — bound to a single project chosen at install
     * time; its created data (tasks/runs) and its entry point live inside that
     * project. Absent ⇒ `org` (back-compat); resolve via {@link automationScope}.
     */
    scope: z.enum(['org', 'project']).optional(),
    /**
     * Platform-rendered views this automation opts into (see {@link automationBuiltinViewSchema}).
     * Rendered by the automation page BEFORE any bundled JSON views.
     */
    builtinViews: z.array(automationBuiltinViewSchema).optional(),
    /**
     * The automation's single workflow, authored INLINE (full
     * `workflowJsonSchema` shape). A non-bundle automation owns AT MOST ONE
     * workflow and it lives here — in the built-in catalog manifest AND in
     * every installed org copy — never as a standalone `workflows/<slug>/<name>.json`
     * file. Its slug IS the automation slug (the workflow for automation
     * `create-github-pr` has slug `create-github-pr`). Resolved + persisted
     * through `convex/workflows/definition_store.ts` (inline-first, with global
     * `org/workflows/*.json` files as the fallback for standalone workflows).
     * Agent refs inside it (`<slug>/<agent>`) are unaffected.
     */
    workflow: workflowJsonSchema.optional(),
    /** Agent slugs this automation composes (referenced, they live in agents/). */
    agents: z.array(z.string()).optional(),
    /**
     * Skill slugs this automation ships — each carried at `skills/<slug>/` in the
     * bundle (SKILL.md + assets) and fanned out into the org's shared
     * `skills/` dir on install. A DISPLAY declaration (mirrors `agents`): it
     * lets the hub list the skills pre-install; the fan-out copies whatever
     * the bundle's `skills/` dir carries.
     */
    skills: z.array(z.string()).optional(),
    /**
     * Integration slugs this automation provides — their DEFINITIONS (connector +
     * config, never secrets) are copied into the org on install. The per-org
     * credential (e.g. a GitHub token) is collected by the readiness wizard, not
     * copied. Listed in `requires.integrations` if the automation can't run without it.
     */
    integrations: z.array(z.string()).optional(),
    /** role token -> agent slug (the automation's cast). */
    roles: z.record(z.string(), z.string()).optional(),
    /**
     * Readiness contract — what must be provided per-org before the automation works.
     * Drives the non-blocking setup checklist on automation entry. `integrations` =
     * slugs whose credential must be connected (checked via `computeAvailability`).
     * There is no install-time `config` any more — an automation that needs an operator
     * value reads it from an integration credential or a workflow's trigger/
     * schedule variables (see the `Form` block and `formFieldSchema` in
     * `automation_views.ts`, which still share the field grammar for THAT surface).
     */
    requires: z
      .object({
        integrations: z.array(z.string()).optional(),
      })
      .optional(),
    /**
     * Capability allowlist — the automation's declared surface of platform powers its
     * views may DO (the Forge/Slack manifest model). An action can never act
     * beyond this: `trigger_workflow` targets must be in `workflows`, `assign`
     * targets in `roles`. Enforced at dispatch + checked at publish.
     */
    capabilities: z
      .object({
        workflows: z.array(z.string()).optional(),
        roles: z.array(z.string()).optional(),
        queues: z.array(z.string()).optional(),
        /**
         * The allowlist of public Convex functions the automation's views may call —
         * the "data freedom" surface. A bound component / action may only invoke
         * a `path` listed here (validated at publish, gated client-side, audited).
         * `path` is the `makeFunctionReference` form `<dir>/<file>:<export>`.
         */
        functions: z
          .array(
            z.object({
              path: z.string(),
              mode: z.enum(['query', 'mutation', 'action']),
            }),
          )
          .optional(),
      })
      .optional(),
  })
  .passthrough();

export type AutomationManifest = z.infer<typeof automationManifestSchema>;

/**
 * A BUNDLE manifest (`automations/<slug>/bundle.json`) — an aggregator that
 * installs several member automations together through ONE wizard and does
 * NOTHING itself. It is detected by the presence of
 * {@link BUNDLE_MANIFEST_FILENAME} (a regular automation ships
 * {@link AUTOMATION_MANIFEST_FILENAME} instead) and carries ONLY display fields
 * plus its required `bundle.members`. `.strict()` FORBIDS every install-bearing
 * field (workflow/workflows/agents/skills/integrations/roles/requires/
 * capabilities/builtinViews — and `hidden`): the "a bundle does nothing itself"
 * rule, enforced at parse time so a bundle that declares its own resources can
 * never ship. Members install in declared order
 * (`install_bundle_actions.ts`); each must exist, be `hidden: true`, and share
 * this bundle's `scope` (enforced by `validateBundleShape`).
 */
export const bundleManifestSchema = z
  .object({
    /** Friendly display name shown in the catalog (the slug is the dir name). */
    name: z.string(),
    /** One-line catalog description. */
    description: z.string().optional(),
    /** Per-locale display overrides; see {@link automationManifestI18nSchema}. */
    i18n: automationManifestI18nSchema.optional(),
    /** Optional lucide icon name for the catalog card. */
    icon: z.string().optional(),
    /** Display folder (see {@link automationManifestSchema}'s `folder`). */
    folder: z.string().max(64).regex(AUTOMATION_FOLDER_REGEX).optional(),
    /** Short catalog labels (literal, untranslated proper nouns). */
    labels: z.array(z.string()).max(6).optional(),
    /** Where the members install/run; every member must share it. */
    scope: z.enum(['org', 'project']).optional(),
    /** The members this bundle installs together, in declared install order. */
    bundle: z.object({
      /** Member automation slugs, installed in this order by `installBundle`. */
      members: z.array(z.string()).min(1),
    }),
  })
  .strict();

export type BundleManifest = z.infer<typeof bundleManifestSchema>;

/**
 * Whether a parsed catalog manifest is a {@link BundleManifest} (declares
 * `bundle.members`) rather than an ordinary {@link AutomationManifest}. A bundle
 * is authored as {@link BUNDLE_MANIFEST_FILENAME} and parsed by
 * {@link bundleManifestSchema}, so only a bundle carries the `bundle` field.
 */
export function manifestDeclaresBundle(
  manifest: AutomationManifest | BundleManifest,
): manifest is BundleManifest {
  return 'bundle' in manifest;
}

/** An automation's install/runtime scope. */
export type AutomationScope = 'org' | 'project';

/**
 * Resolve an automation's effective scope. An unset manifest `scope` means org-level —
 * the back-compat default for every automation authored before scoping existed. Always
 * read scope through this so the default lives in exactly one place.
 */
export function automationScope(
  manifest: { scope?: AutomationScope } | null | undefined,
): AutomationScope {
  return manifest?.scope ?? 'org';
}

/**
 * Resolve the display folder an automation's agents/workflows group under. An unset
 * manifest `folder` means the automation slug — the shape every folder-grouped list
 * rendered before folders existed. Always read the folder through this so the
 * fallback lives in exactly one place (mirrors {@link automationScope}).
 */
export function automationDisplayFolder(
  manifest: { folder?: string } | null | undefined,
  automationSlug: string,
): string {
  return manifest?.folder ?? automationSlug;
}

/** Automation slug — same alphabet as skills/workflows (kebab segments). */
const AUTOMATION_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidAutomationSlug(slug: string): boolean {
  return AUTOMATION_SLUG_REGEX.test(slug) && slug.length <= 64;
}

/** The manifest file at the root of an automation bundle (its dir name is the slug). */
export const AUTOMATION_MANIFEST_FILENAME = 'automation.json';

/**
 * The manifest file at the root of a BUNDLE dir (its dir name is the slug) —
 * present INSTEAD of {@link AUTOMATION_MANIFEST_FILENAME}. Its presence is how
 * loaders/installers tell a bundle from an ordinary automation; it is parsed by
 * {@link bundleManifestSchema}.
 */
export const BUNDLE_MANIFEST_FILENAME = 'bundle.json';

/**
 * @deprecated Legacy manifest filename — a bundle installed/uploaded before
 * the Automations rename shipped may still carry it on disk. Every reader
 * DUAL-ACCEPTS {@link AUTOMATION_MANIFEST_FILENAME} OR this one (never both
 * for the SAME bundle); every writer emits only the canonical name. No
 * customer fs-tree migration needed — see `convex/automations/file_utils.ts`
 * (`resolveManifestFilePath`) for the read-time fallback.
 */
export const APP_MANIFEST_FILENAME = 'app.json';

/**
 * Limits for an UPLOADED automation bundle (the private-automation upload path). An automation is
 * richer than a skill — it can carry agents, workflows, views,
 * scripts and integration definitions — so the entry cap is higher than the
 * skill bundle's, while the byte caps match (binary assets dominate either way).
 * Enforced identically on the client (UX) and the server (authoritative).
 */
export const MAX_AUTOMATION_BUNDLE_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB per file
export const MAX_AUTOMATION_BUNDLE_TOTAL_BYTES = 20 * 1024 * 1024; // 20 MiB decompressed
export const MAX_AUTOMATION_BUNDLE_ENTRIES = 500;

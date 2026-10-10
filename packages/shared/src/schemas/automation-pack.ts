/** Pure contracts for automation packages; catalog reading and execution stay in the platform. */

import { z } from 'zod/v4';

import { automationSettingsSchema } from './automation-settings';
import { triggerWriteSchema } from './automation-trigger';
import { isValidSkillSlug } from './skills';
import { taskSubjectContractSchema } from './task-contract';

/**
 * Caps for an uploaded automation package zip — the pack format's files
 * (`workflow.yml` + `automation.yml`) plus the skill bundles it carries under
 * `skills/<slug>/`. Sized like the bundle caps main shipped with: an
 * automation package is richer than a lone skill bundle (it may carry several),
 * so the entry cap is generous while the byte caps match the skill domain's
 * order of magnitude. The parser enforces them per entry and as a running
 * decompressed total, and the upload action pre-filters on the compressed blob
 * size before a single entry is inflated.
 */

/** Cap on one decompressed file inside the package zip. */
export const MAX_AUTOMATION_BUNDLE_FILE_BYTES = 2 * 1024 * 1024;

/** Cap on the package's total decompressed bytes across all files. */
export const MAX_AUTOMATION_BUNDLE_TOTAL_BYTES = 20 * 1024 * 1024;

/** Cap on the number of zip entries, counted before any content is read. */
export const MAX_AUTOMATION_BUNDLE_ENTRIES = 500;

/** Cap on the skills one package may declare and carry. */
const MAX_PACK_SKILLS = 20;

/**
 * What starts a pack's automation — the shared trigger contract
 * (`triggerWriteSchema`), so a pack declares a trigger exactly as the editor,
 * REST and MCP write one: a schedule's repeat rule or cron in a zone, a
 * webhook, an event, and any fixed input. A pack DECLARES what it wants and
 * the host creates the binding once per organization, so an organization's
 * own edits always win afterwards. Two keys are not a pack's to declare: a
 * schedule's `startDate` (the anchor is the day the pack is installed) and a
 * webhook's `rotateToken` (a pack mints nothing to rotate). There is no
 * `api-key` kind — a programmatic start is what the REST and MCP surfaces
 * are for.
 *
 * A pack's `enabled` reads as **false** when omitted, unlike a write, where
 * it reads as true: a seeded automation has nothing deployed, so its trigger
 * waits for the person who deploys it to turn it on. The default is applied
 * where the trigger is bound (the provisioning), not here — the schema hands
 * the manifest back as written, which a native release compares against.
 */
export const automationTriggerSchema = triggerWriteSchema.superRefine(
  (trigger, ctx) => {
    for (const key of ['startDate', 'rotateToken'] as const) {
      if (key in trigger) {
        ctx.addIssue({
          code: 'custom',
          message: `a pack does not declare "${key}"`,
          path: [key],
        });
      }
    }
  },
);

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
      .object({ connectors: z.array(z.string().min(1)).optional() })
      .strict()
      .optional(),
    /**
     * Product surfaces this pack opens when installed and deployed — today
     * only `inbox` (the shared Conversations Inbox). Kept on the manifest so
     * the Inbox gate and compose mailbox list can find it without re-reading
     * the workflow document.
     */
    builtinViews: z
      .array(
        z
          .object({
            id: z.string().min(1),
          })
          .strict(),
      )
      .max(8)
      .optional(),
    triggers: z.array(automationTriggerSchema).optional(),
    /**
     * Skill bundles the package CARRIES at `skills/<slug>/` — installed into
     * the organization's skills domain on upload. The declaration is
     * authoritative, not display: the upload refuses a package whose carried
     * directories and declared slugs differ in either direction, so a package
     * can neither smuggle an undeclared bundle nor promise one it doesn't
     * ship. Builtin packs declare none — their skills live in the shared
     * `custom/skills/` catalog every organization is seeded with.
     */
    skills: z
      .array(
        z.string().refine(isValidSkillSlug, {
          message:
            'must be a valid skill slug (lowercase letters, digits, single hyphens, not reserved)',
        }),
      )
      .max(MAX_PACK_SKILLS)
      .optional(),
    /** Task-surface bindings: `subjects.task` is the contract the task board
     * choreographs against once the pack is installed and deployed. */
    subjects: z
      .object({ task: taskSubjectContractSchema.optional() })
      .strict()
      .optional(),
    /** Operator-editable configuration rendered as forms and persisted as
     * flat-YAML files in a project folder (see automation-settings schema). */
    settings: automationSettingsSchema.optional(),
    i18n: packI18nSchema.optional(),
  })
  .strict();

export type AutomationPackManifest = z.infer<
  typeof automationPackManifestSchema
>;
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

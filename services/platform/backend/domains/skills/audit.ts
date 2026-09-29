import type { SkillFrontmatter } from '@tale/shared/schemas/skills';
import type { TransactionSql } from 'postgres';

import type { SkillRevision } from '../../core/skills/file_actions.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import type { AuditLogActorType } from '../audit_logs/types.ts';

/**
 * The audit record of a skill write — the governance trail under Settings >
 * Governance > Logs (category `skill`) and the source the library's "Last
 * edited by" is read from (`attribution.ts`). Every write door records
 * through here, inside the transaction that holds the skill's writer lock,
 * after the bundle is written: the editor's save (app and REST), the ZIP
 * upload and an automation package's carried skills.
 *
 * - `skill.created` — the slug held no readable skill before;
 * - `skill.updated` — the stored `SKILL.md` or another bundle file changed,
 *   with the fields that did in `changedFields`;
 * - `skill.sharing_changed` — additionally, when the audience moved: the
 *   visibility and teams before and after.
 *
 * Every row carries the resulting document's tag as `metadata.etag`, which
 * is what ties a row to the bytes it produced. A write that changed nothing
 * — a save of an identical document, an upload of identical files — records
 * nothing.
 */

/** The door a write came through, recorded as `metadata.via`. */
export type SkillWriteDoor = 'app' | 'api' | 'upload' | 'automation_package';

export interface SkillWriteAudit {
  organizationId: string;
  slug: string;
  actor: {
    id: string;
    email?: string | null;
    role?: string;
    type?: AuditLogActorType;
  };
  via: SkillWriteDoor;
  previous: SkillRevision | null;
  current: SkillRevision;
  /** A file of the bundle other than `SKILL.md` changed (an upload). */
  filesChanged?: boolean;
}

/** The audit actions a skill write records. */
export const SKILL_WRITE_ACTIONS = {
  created: 'skill.created',
  updated: 'skill.updated',
  sharingChanged: 'skill.sharing_changed',
} as const;

/** Key order must not make two equal values differ. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** The compared fields, in the order `changedFields` lists them. */
const COMPARED_FIELDS: ReadonlyArray<
  readonly [string, (revision: SkillRevision) => unknown]
> = [
  ['description', (revision) => revision.meta.description],
  ['body', (revision) => revision.body],
  ['visibility', (revision) => revision.meta.visibility],
  ['teams', (revision) => sortedTeams(revision.meta)],
  ['owner', (revision) => revision.meta.owner],
  ['icon', (revision) => revision.meta.icon],
  ['labels', (revision) => revision.meta.labels],
  [
    'disableModelInvocation',
    (revision) => revision.meta.disableModelInvocation === true,
  ],
  ['license', (revision) => revision.meta.license],
  ['recommendedPackages', (revision) => revision.meta.recommendedPackages],
  ['metadata', (revision) => revision.meta.metadata],
  ['frontmatter', (revision) => revision.meta.extra],
];

function sortedTeams(meta: SkillFrontmatter): string[] | undefined {
  return meta.teams === undefined ? undefined : [...meta.teams].sort();
}

/** The `SKILL.md` fields that differ between two revisions. */
export function skillChangedFields(
  previous: SkillRevision,
  current: SkillRevision,
): string[] {
  return COMPARED_FIELDS.filter(
    ([, read]) => stableJson(read(previous)) !== stableJson(read(current)),
  ).map(([field]) => field);
}

function sharingOf(meta: SkillFrontmatter): {
  visibility: SkillFrontmatter['visibility'];
  teams: string[];
} {
  return { visibility: meta.visibility, teams: sortedTeams(meta) ?? [] };
}

export async function auditSkillWrite(
  tx: TransactionSql,
  args: SkillWriteAudit,
): Promise<void> {
  const common = {
    organizationId: args.organizationId,
    actorId: args.actor.id,
    ...(args.actor.email ? { actorEmail: args.actor.email } : {}),
    ...(args.actor.role !== undefined ? { actorRole: args.actor.role } : {}),
    actorType: args.actor.type ?? 'user',
    category: 'skill' as const,
    resourceType: 'skill',
    resourceId: args.slug,
    resourceName: args.slug,
    status: 'success' as const,
    metadata: { etag: args.current.etag, via: args.via },
  };

  if (args.previous === null) {
    await createAuditLog(tx, {
      ...common,
      action: SKILL_WRITE_ACTIONS.created,
      newState: sharingOf(args.current.meta),
    });
    return;
  }

  const changedFields = skillChangedFields(args.previous, args.current);
  if (args.filesChanged === true) changedFields.push('files');
  if (changedFields.length === 0 && args.previous.etag === args.current.etag) {
    return;
  }
  await createAuditLog(tx, {
    ...common,
    action: SKILL_WRITE_ACTIONS.updated,
    changedFields,
    metadata: { ...common.metadata, previousEtag: args.previous.etag },
  });

  const before = sharingOf(args.previous.meta);
  const after = sharingOf(args.current.meta);
  if (stableJson(before) !== stableJson(after)) {
    await createAuditLog(tx, {
      ...common,
      action: SKILL_WRITE_ACTIONS.sharingChanged,
      previousState: before,
      newState: after,
      changedFields: [
        ...(before.visibility !== after.visibility ? ['visibility'] : []),
        ...(stableJson(before.teams) !== stableJson(after.teams)
          ? ['teams']
          : []),
      ],
    });
  }
}

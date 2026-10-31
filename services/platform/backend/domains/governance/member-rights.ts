import type { Sql } from 'postgres';

import {
  competenceRecordStatus,
  type MemberRight,
  type MemberRightReason,
  type MemberRights,
  PLATFORM_CAPABILITIES,
  type PlatformCapability,
  type RoleStanding,
} from '../../../lib/shared/competences.ts';
import { findOrganizationMember } from '../../auth/membership.ts';
import { orgWideAudienceRoleStanding } from '../../core/lib/audience.ts';
import { actAsRoleStanding, mayActAs } from '../../rest/actor.ts';
import {
  mayExportNotifications,
  notificationExportRoleStanding,
} from '../../rest/v1-notifications.ts';
import {
  modelApiRoleStanding,
  resolveModelApiGate,
} from '../model_api/access.ts';
import { resolveSkillPublishing } from '../skills/publish.ts';
import { type CompetenceRecord, listRecordsVouchingFor } from './competence.ts';

/**
 * One member's platform rights, as the doors that check them answer, with
 * the reasons — the Rights dialog of Settings › Members (GOV-R21).
 *
 * Nothing here decides a right. Each verdict is its door's own answer, the
 * door called with the member as the caller; each reason is a fact the door
 * weighs, read through the function the door decides by: its role standing,
 * the organization's switch or policy it reads, and the register's grant.
 * A rule changed at a door is the rule this read reports.
 */

interface Caller {
  organizationId: string;
  userId: string;
  role: string;
}

interface DoorAnswer {
  capability: PlatformCapability;
  held: boolean;
  standing: RoleStanding;
  /** What the organization says at this door, before the role. */
  context: MemberRightReason[];
}

async function askDoor(
  sql: Sql,
  caller: Caller,
  capability: PlatformCapability,
  now: number,
): Promise<DoorAnswer> {
  switch (capability) {
    case 'tale:models.api': {
      // The switch first, then the right — a switch that is off answers
      // for every member without reading the grant.
      const gate = await resolveModelApiGate(sql, caller, now);
      return {
        capability,
        held: gate.kind === 'open',
        standing: modelApiRoleStanding(caller.role),
        context: [
          {
            kind: 'organization',
            setting: 'model_api',
            state:
              gate.kind === 'unavailable'
                ? 'unreadable'
                : gate.kind === 'disabled'
                  ? 'off'
                  : 'on',
          },
        ],
      };
    }
    case 'tale:notifications.export':
      return {
        capability,
        held: await mayExportNotifications(sql, caller, now),
        standing: notificationExportRoleStanding(caller.role),
        context: [],
      };
    case 'tale:rest.act-as':
      return {
        capability,
        held: await mayActAs(sql, caller, now),
        standing: actAsRoleStanding(caller.role),
        context: [],
      };
    case 'tale:skills.publish': {
      const { mode, allowed } = await resolveSkillPublishing(sql, caller, now);
      return {
        capability,
        held: allowed,
        standing: orgWideAudienceRoleStanding(caller.role, mode),
        context: [{ kind: 'policy', policy: 'skill_sharing', mode }],
      };
    }
    default: {
      // A capability joins the closed set together with its door, and so
      // with its case here.
      const unknown: never = capability;
      throw new Error(`No door answers ${String(unknown)}`);
    }
  }
}

function rightOf(
  door: DoorAnswer,
  records: readonly CompetenceRecord[],
  now: number,
): MemberRight {
  // The records `holdsCapability` reads: the partial unique indexes keep at
  // most one unrevoked record of the member's own per competence, and one
  // per team that holds it.
  const vouching = records.filter(
    (row) => row.competence === door.capability && row.revokedAt === null,
  );
  const statusOf = (row: CompetenceRecord) =>
    competenceRecordStatus(row, now) === 'active' ? 'active' : 'expired';
  const own = vouching.find((row) => row.teamId === null);
  const reasons: MemberRightReason[] = [
    ...door.context,
    { kind: 'role', standing: door.standing },
  ];
  if (own !== undefined) {
    reasons.push({
      kind: 'grant',
      recordId: own.id,
      grantedBy: own.grantedBy,
      grantedAt: own.grantedAt,
      expiresAt: own.expiresAt,
      status: statusOf(own),
    });
  }
  for (const row of vouching) {
    if (row.teamId === null) continue;
    reasons.push({
      kind: 'team',
      recordId: row.id,
      teamId: row.teamId,
      teamName: row.teamName,
      grantedBy: row.grantedBy,
      grantedAt: row.grantedAt,
      expiresAt: row.expiresAt,
      status: statusOf(row),
    });
  }
  if (vouching.length === 0 && door.standing === 'grant') {
    reasons.push({ kind: 'no-grant' });
  }
  return {
    capability: door.capability,
    held: door.held,
    // The switch is the member's own grant; a team's is changed in the
    // register.
    grantId: own !== undefined && statusOf(own) === 'active' ? own.id : null,
    reasons,
  };
}

/** The member's rights, or `null` when the user is not a member of the
 * organization. */
export async function readMemberRights(
  sql: Sql,
  args: { organizationId: string; userId: string; now?: number },
): Promise<MemberRights | null> {
  const member = await findOrganizationMember(
    sql,
    args.organizationId,
    args.userId,
  );
  if (member === null) return null;
  const now = args.now ?? Date.now();
  const caller: Caller = {
    organizationId: args.organizationId,
    userId: args.userId,
    role: member.role,
  };
  const [records, doors] = await Promise.all([
    listRecordsVouchingFor(sql, args.organizationId, args.userId),
    Promise.all(
      PLATFORM_CAPABILITIES.map((capability) =>
        askDoor(sql, caller, capability, now),
      ),
    ),
  ]);
  return {
    userId: args.userId,
    role: member.role,
    rights: doors.map((door) => rightOf(door, records, now)),
  };
}

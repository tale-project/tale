import {
  memberRoleSchema,
  type MemberRole,
} from '@/lib/shared/schemas/organizations';

export function isMemberRole(role: string | undefined): role is MemberRole {
  return memberRoleSchema.safeParse(role).success;
}

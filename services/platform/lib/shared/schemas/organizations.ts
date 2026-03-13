import { z } from 'zod/v4';

const memberRoleLiterals = [
  'owner',
  'disabled',
  'member',
  'editor',
  'developer',
  'admin',
] as const;
export const memberRoleSchema = z.enum(memberRoleLiterals);
export type MemberRole = z.infer<typeof memberRoleSchema>;

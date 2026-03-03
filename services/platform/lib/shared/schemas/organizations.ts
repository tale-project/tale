import { z } from 'zod/v4';

const memberRoleLiterals = [
  'disabled',
  'member',
  'editor',
  'developer',
  'admin',
] as const;
export const memberRoleSchema = z.enum(memberRoleLiterals);
export type MemberRole = z.infer<typeof memberRoleSchema>;

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

/**
 * Organization name is required: non-empty once trimmed. Shared so the client
 * settings form and the Convex `beforeUpdateOrganization` hook enforce the same
 * rule from a single source — neither layer can drift from the other. The
 * optional `message` lets the client inject a localized error; the server
 * relies on `safeParse` success/failure and supplies its own message.
 */
export const organizationNameSchema = (message?: string) =>
  z.string().trim().min(1, message);

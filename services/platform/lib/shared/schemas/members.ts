import { z } from 'zod';
import { jsonRecordSchema } from './utils/json-value';

export const memberListItemSchema = z.object({
	_id: z.string(),
	_creationTime: z.number(),
	organizationId: z.string(),
	identityId: z.string().optional(),
	email: z.string().optional(),
	role: z.string().optional(),
	displayName: z.string().optional(),
	metadata: jsonRecordSchema.optional(),
});
export type MemberListItem = z.infer<typeof memberListItemSchema>;

export const memberSchema = z.object({
	_id: z.string(),
	_creationTime: z.number(),
	organizationId: z.string(),
	identityId: z.string().optional(),
	email: z.string().optional(),
	role: z.string().optional(),
	displayName: z.string().optional(),
});
export type Member = z.infer<typeof memberSchema>;

export const memberContextSchema = z.object({
	member: memberSchema.nullable(),
	role: z.string().nullable(),
	isAdmin: z.boolean(),
	canManageMembers: z.boolean(),
	canChangePassword: z.boolean(),
});
export type MemberContext = z.infer<typeof memberContextSchema>;

export const addMemberResponseSchema = z.object({
	memberId: z.string(),
});
export type AddMemberResponse = z.infer<typeof addMemberResponseSchema>;

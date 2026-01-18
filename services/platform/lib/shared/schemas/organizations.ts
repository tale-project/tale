import { z } from 'zod/v4';
import { jsonRecordSchema } from './utils/json-value';

export const memberRoleLiterals = ['disabled', 'member', 'editor', 'developer', 'admin'] as const;
export const memberRoleSchema = z.enum(memberRoleLiterals);
export type MemberRole = z.infer<typeof memberRoleSchema>;

export const organizationSchema = z.object({
	_id: z.string(),
	_creationTime: z.number(),
	name: z.string(),
	slug: z.string().optional(),
	logoId: z.string().optional(),
	metadata: jsonRecordSchema.optional(),
});
export type Organization = z.infer<typeof organizationSchema>;

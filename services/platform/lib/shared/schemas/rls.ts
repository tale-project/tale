import { z } from 'zod';

export const organizationIdArgSchema = z.string();
export type OrganizationIdArg = z.infer<typeof organizationIdArgSchema>;

export const rlsWithPaginationArgsSchema = z.object({
	organizationId: z.string(),
	page: z.number().optional(),
	size: z.number().optional(),
});
export type RlsWithPaginationArgs = z.infer<typeof rlsWithPaginationArgsSchema>;

export const rlsWithSearchArgsSchema = z.object({
	organizationId: z.string(),
	query: z.string().optional(),
});
export type RlsWithSearchArgs = z.infer<typeof rlsWithSearchArgsSchema>;

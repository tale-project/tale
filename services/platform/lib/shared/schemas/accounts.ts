import { z } from 'zod';

export const oauthAccountSchema = z.object({
	accountId: z.string(),
	userId: z.string(),
	providerId: z.string(),
	accessToken: z.union([z.string(), z.null()]),
	accessTokenExpiresAt: z.union([z.number(), z.null()]),
	refreshToken: z.union([z.string(), z.null()]),
	refreshTokenExpiresAt: z.union([z.number(), z.null()]),
	scope: z.union([z.string(), z.null()]),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type OAuthAccount = z.infer<typeof oauthAccountSchema>;

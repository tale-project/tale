import { z } from 'zod';

export const oauthAccountSchema = z.object({
	accountId: z.string(),
	userId: z.string(),
	providerId: z.string(),
	accessToken: z.string().nullable(),
	accessTokenExpiresAt: z.number().nullable(),
	refreshToken: z.string().nullable(),
	refreshTokenExpiresAt: z.number().nullable(),
	scope: z.string().nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type OAuthAccount = z.infer<typeof oauthAccountSchema>;

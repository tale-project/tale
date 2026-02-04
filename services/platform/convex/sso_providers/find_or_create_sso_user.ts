import { GenericMutationCtx } from 'convex/server';
import { DataModel } from '../_generated/dataModel';
import { components } from '../_generated/api';
import type { PlatformRole } from './types';

type FindOrCreateSsoUserArgs = {
	email: string;
	name: string;
	externalId: string;
	providerId: string;
	accessToken: string;
	refreshToken?: string;
	accessTokenExpiresAt?: number;
	organizationId: string;
	role: PlatformRole;
};

type FindOrCreateSsoUserResult = {
	userId: string | null;
	isNewUser: boolean;
};

export async function findOrCreateSsoUser(
	ctx: GenericMutationCtx<DataModel>,
	args: FindOrCreateSsoUserArgs,
): Promise<FindOrCreateSsoUserResult> {
	const existingUserRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
		model: 'user',
		paginationOpts: { cursor: null, numItems: 1 },
		where: [{ field: 'email', value: args.email, operator: 'eq' }],
	});

	const existingUser = existingUserRes?.page?.[0] as { _id?: string; id?: string } | undefined;
	const existingUserId = existingUser?._id ?? existingUser?.id;

	if (existingUserId) {
		const existingAccountRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'account',
			paginationOpts: { cursor: null, numItems: 1 },
			where: [
				{ field: 'userId', value: existingUserId, operator: 'eq' },
				{ field: 'providerId', value: args.providerId, operator: 'eq' },
			],
		});

		const existingAccount = existingAccountRes?.page?.[0] as { _id?: string } | undefined;

		if (!existingAccount) {
			const now = Date.now();
			await ctx.runMutation(components.betterAuth.adapter.create, {
				input: {
					model: 'account',
					data: {
						userId: existingUserId,
						providerId: args.providerId,
						accountId: args.externalId,
						accessToken: args.accessToken,
						refreshToken: args.refreshToken ?? null,
						accessTokenExpiresAt: args.accessTokenExpiresAt ?? null,
						createdAt: now,
						updatedAt: now,
					},
				},
			});
		} else if (existingAccount._id) {
			await ctx.runMutation(components.betterAuth.adapter.updateMany, {
				input: {
					model: 'account' as const,
					where: [{ field: '_id', value: existingAccount._id, operator: 'eq' }],
					update: {
						accessToken: args.accessToken,
						refreshToken: args.refreshToken ?? null,
						accessTokenExpiresAt: args.accessTokenExpiresAt ?? null,
						updatedAt: Date.now(),
					},
				},
				paginationOpts: { cursor: null, numItems: 1 },
			});
		}

		const membershipRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'member',
			paginationOpts: { cursor: null, numItems: 1 },
			where: [
				{ field: 'userId', value: existingUserId, operator: 'eq' },
				{ field: 'organizationId', value: args.organizationId, operator: 'eq' },
			],
		});

		const existingMembership = membershipRes?.page?.[0];

		if (!existingMembership) {
			await ctx.runMutation(components.betterAuth.adapter.create, {
				input: {
					model: 'member',
					data: {
						organizationId: args.organizationId,
						userId: existingUserId,
						role: args.role,
						createdAt: Date.now(),
					},
				},
			});
		}

		return { userId: existingUserId, isNewUser: false };
	}

	const now = Date.now();
	const createResult = await ctx.runMutation(components.betterAuth.adapter.create, {
		input: {
			model: 'user',
			data: {
				email: args.email,
				name: args.name,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			},
		},
	});

	const userId: string = (createResult as any)?._id ?? (createResult as any)?.id ?? String(createResult);

	await ctx.runMutation(components.betterAuth.adapter.create, {
		input: {
			model: 'account',
			data: {
				userId,
				providerId: args.providerId,
				accountId: args.externalId,
				accessToken: args.accessToken,
				refreshToken: args.refreshToken ?? null,
				accessTokenExpiresAt: args.accessTokenExpiresAt ?? null,
				createdAt: now,
				updatedAt: now,
			},
		},
	});

	await ctx.runMutation(components.betterAuth.adapter.create, {
		input: {
			model: 'member',
			data: {
				organizationId: args.organizationId,
				userId,
				role: args.role,
				createdAt: now,
			},
		},
	});

	return { userId, isNewUser: true };
}

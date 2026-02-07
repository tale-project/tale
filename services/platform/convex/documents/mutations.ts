import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import { jsonValueValidator, jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { createDocument } from './create_document';
import { deleteDocument as deleteDocumentHelper } from './delete_document';
import { updateDocument as updateDocumentHelper } from './update_document';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { internal } from '../_generated/api';
import { sourceProviderValidator } from './validators';

function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
	if (!a && !b) return true;
	if (!a || !b) return false;
	if (a.length !== b.length) return false;
	const sortedA = [...a].sort();
	const sortedB = [...b].sort();
	return sortedA.every((val, i) => val === sortedB[i]);
}

export const updateDocument = mutation({
	args: {
		documentId: v.id('documents'),
		title: v.optional(v.string()),
		content: v.optional(v.string()),
		metadata: v.optional(jsonValueValidator),
		fileId: v.optional(v.id('_storage')),
		mimeType: v.optional(v.string()),
		extension: v.optional(v.string()),
		sourceProvider: v.optional(sourceProviderValidator),
		externalItemId: v.optional(v.string()),
		teamTags: v.optional(v.array(v.string())),
	},
	handler: async (ctx, args) => {
		const authUser = await authComponent.getAuthUser(ctx);
		if (!authUser) {
			throw new Error('Unauthenticated');
		}

		const document = await ctx.db.get(args.documentId);
		if (!document) {
			throw new Error('Document not found');
		}

		await getOrganizationMember(ctx, document.organizationId, {
			userId: String(authUser._id),
			email: authUser.email,
			name: authUser.name,
		});

		const oldTeamTags = document.teamTags;
		const wasIndexed = document.ragInfo?.status === 'completed';

		await updateDocumentHelper(ctx, {
			...args,
			userId: String(authUser._id),
		});

		if (
			args.teamTags !== undefined &&
			wasIndexed &&
			!arraysEqual(oldTeamTags, args.teamTags)
		) {
			await ctx.scheduler.runAfter(
				0,
				internal.documents.internal_actions.reindexDocumentRag,
				{ documentId: args.documentId },
			);
		}
	},
});

export const deleteDocument = mutation({
	args: {
		documentId: v.id('documents'),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const authUser = await authComponent.getAuthUser(ctx);
		if (!authUser) {
			throw new Error('Unauthenticated');
		}

		const document = await ctx.db.get(args.documentId);
		if (!document) {
			throw new Error('Document not found');
		}

		await getOrganizationMember(ctx, document.organizationId, {
			userId: String(authUser._id),
			email: authUser.email,
			name: authUser.name,
		});

		await deleteDocumentHelper(ctx, args.documentId);

		await ctx.scheduler.runAfter(0, internal.documents.internal_actions.deleteDocumentFromRag, {
			documentId: String(args.documentId),
		});

		return null;
	},
});

export const createDocumentFromUpload = mutation({
	args: {
		organizationId: v.string(),
		fileId: v.id('_storage'),
		fileName: v.string(),
		contentType: v.optional(v.string()),
		contentHash: v.optional(v.string()),
		metadata: v.optional(jsonRecordValidator),
		teamTags: v.optional(v.array(v.string())),
	},
	returns: v.object({
		success: v.boolean(),
		documentId: v.id('documents'),
	}),
	handler: async (ctx, args) => {
		const authUser = await authComponent.getAuthUser(ctx);
		if (!authUser) {
			throw new Error('Unauthenticated');
		}

		await getOrganizationMember(ctx, args.organizationId, {
			userId: String(authUser._id),
			email: authUser.email,
			name: authUser.name,
		});

		const result = await createDocument(ctx, {
			organizationId: args.organizationId,
			title: args.fileName,
			fileId: args.fileId,
			mimeType: args.contentType,
			contentHash: args.contentHash,
			sourceProvider: 'upload',
			teamTags: args.teamTags,
			metadata: args.metadata,
			createdBy: String(authUser._id),
		});

		return {
			success: true,
			documentId: result.documentId,
		};
	},
});

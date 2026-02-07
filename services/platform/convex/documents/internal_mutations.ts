import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { createDocument as createDocumentHelper } from './create_document';
import { updateDocumentInternal as updateDocumentInternalHelper } from './update_document_internal';
import { updateDocumentRagInfo as updateDocumentRagInfoHelper } from './update_document_rag_info';
import { sourceProviderValidator, ragInfoValidator } from './validators';

export const updateDocument = internalMutation({
	args: {
		documentId: v.id('documents'),
		title: v.optional(v.string()),
		content: v.optional(v.string()),
		metadata: v.optional(jsonRecordValidator),
		fileId: v.optional(v.id('_storage')),
		mimeType: v.optional(v.string()),
		extension: v.optional(v.string()),
		sourceProvider: v.optional(sourceProviderValidator),
		externalItemId: v.optional(v.string()),
		contentHash: v.optional(v.string()),
		teamTags: v.optional(v.array(v.string())),
	},
	handler: async (ctx, args) => {
		await updateDocumentInternalHelper(ctx, args);
	},
});

export const updateDocumentRagInfo = internalMutation({
	args: {
		documentId: v.id('documents'),
		ragInfo: ragInfoValidator,
	},
	handler: async (ctx, args) => {
		await updateDocumentRagInfoHelper(ctx, args);
	},
});

export const createDocument = internalMutation({
	args: {
		organizationId: v.string(),
		title: v.string(),
		content: v.optional(v.string()),
		fileId: v.optional(v.id('_storage')),
		mimeType: v.optional(v.string()),
		extension: v.optional(v.string()),
		sourceProvider: v.optional(sourceProviderValidator),
		externalItemId: v.optional(v.string()),
		contentHash: v.optional(v.string()),
		metadata: v.optional(jsonRecordValidator),
		teamTags: v.optional(v.array(v.string())),
		createdBy: v.optional(v.string()),
	},
	returns: v.id('documents'),
	handler: async (ctx, args) => {
		const result = await createDocumentHelper(ctx, args);
		return result.documentId;
	},
});

import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import * as ApprovalsHelpers from './helpers';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { authComponent } from '../auth';
import { approvalStatusValidator } from './validators';

export const updateApprovalStatus = mutation({
	args: {
		approvalId: v.id('approvals'),
		status: approvalStatusValidator,
		comments: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const authUser = await authComponent.getAuthUser(ctx);
		if (!authUser) {
			throw new Error('Unauthenticated');
		}

		const approval = await ctx.db.get(args.approvalId);
		if (!approval) {
			throw new Error('Approval not found');
		}

		const previousStatus = approval.status;

		await ApprovalsHelpers.updateApprovalStatus(ctx, {
			approvalId: args.approvalId,
			status: args.status,
			approvedBy: String(authUser._id),
			comments: args.comments,
		});

		const action = args.status === 'approved' ? 'approve_request' : 'reject_request';

		await AuditLogHelpers.logSuccess(
			ctx,
			{
				organizationId: approval.organizationId,
				actor: {
					id: String(authUser._id),
					email: authUser.email,
					type: 'user',
				},
			},
			action,
			'workflow',
			'approval',
			String(args.approvalId),
			approval.resourceType,
			{ status: previousStatus },
			{ status: args.status, comments: args.comments },
		);

		return null;
	},
});

export const removeRecommendedProduct = mutation({
	args: {
		approvalId: v.id('approvals'),
		productId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const authUser = await authComponent.getAuthUser(ctx);
		if (!authUser) {
			throw new Error('Unauthenticated');
		}

		const approval = await ctx.db.get(args.approvalId);
		if (!approval) {
			throw new Error('Approval not found');
		}

		await ApprovalsHelpers.removeRecommendedProduct(ctx, {
			approvalId: args.approvalId,
			productId: args.productId,
		});

		await AuditLogHelpers.logSuccess(
			ctx,
			{
				organizationId: approval.organizationId,
				actor: {
					id: String(authUser._id),
					email: authUser.email,
					type: 'user',
				},
			},
			'remove_recommended_product',
			'workflow',
			'approval',
			String(args.approvalId),
			approval.resourceType,
			undefined,
			undefined,
			{ productId: args.productId },
		);

		return null;
	},
});

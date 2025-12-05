import 'convex/server';

declare module 'convex/server' {
	interface GenericActionCtx<DataModel extends GenericDataModel> {
		organizationId?: string;
		workflowId?: string;
		variables?: Record<string, unknown>;
	}
}

import 'convex/server';

declare module 'convex/server' {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	interface GenericActionCtx<DataModel extends GenericDataModel> {
		organizationId?: string;
		workflowId?: string;
		variables?: Record<string, unknown>;
	}
}
